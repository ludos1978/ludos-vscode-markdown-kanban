// Use the global vscode instance set up in HTML
// (vscode is already declared globally in webview.html)

// MEMORY SAFETY: Guard flag to prevent duplicate event listeners on webview revival
// When VS Code restores a webview from serialized state, all scripts run again.
// This flag ensures listeners are only added once.
let webviewEventListenersInitialized = false;

// Global variables
let currentFileInfo = null;
let currentBoard = null;
window.currentBoard = currentBoard; // Expose to window for debug overlay verification
// Note: lastClipboardCheck, clipboardCardData, CLIPBOARD_CHECK_THROTTLE are declared in clipboardHandler.js

// Note: window.tagColors is set by backend in boardUpdate message
// Do NOT initialize to {} here - it prevents actual config from loading!

// MD5 hash generation function using Web Crypto API
async function generateMD5Hash(arrayBuffer) {
    try {
        // Use SHA-256 instead of MD5 as it's more widely supported and secure
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex.substring(0, 16); // Take first 16 characters to simulate MD5 length
    } catch (error) {
        console.error('❌ Failed to generate hash:', error.message);
        // Fallback to timestamp if crypto fails
        return Date.now().toString(16);
    }
}
let canUndo = false;
let canRedo = false;
window.currentImageMappings = {};

// Layout preferences
let currentColumnWidth = '350px';
let currentWhitespace = '8px';
let currentTaskMinHeight = 'auto';
let currentLayoutRows = 1;

// ============================================================================
// PlantUML Initialization
// ============================================================================

// NOTE: PlantUML is now initialized in markdownRenderer.js (before markdown processing)

// ============================================================================
// PlantUML SVG Conversion
// ============================================================================

/**
 * Diagram conversion configuration
 * Maps diagram types to their specific handlers and message types
 */
const diagramConvertConfig = {
    plantuml: {
        cache: () => plantumlRenderCache,
        render: renderPlantUML,
        messageType: 'convertPlantUMLToSVG',
        codeKey: 'plantUMLCode',
        logPrefix: '[PlantUML]'
    },
    mermaid: {
        cache: () => mermaidRenderCache,
        render: renderMermaid,
        messageType: 'convertMermaidToSVG',
        codeKey: 'mermaidCode',
        logPrefix: '[Mermaid]'
    }
};

/**
 * Unified handler for diagram "Convert to SVG" button clicks
 * @param {HTMLElement} button - The clicked button element
 * @param {'plantuml' | 'mermaid'} diagramType - The type of diagram
 */
async function handleDiagramConvert(button, diagramType) {
    const config = diagramConvertConfig[diagramType];
    if (!config) {
        console.error(`[Diagram] Unknown diagram type: ${diagramType}`);
        return;
    }

    const code = button.getAttribute('data-code');

    if (!code) {
        console.error(`${config.logPrefix} No code found for conversion`);
        return;
    }

    // Disable button during processing
    button.disabled = true;
    button.textContent = '⏳ Converting...';

    try {
        // Get SVG from cache or render it
        let svg;
        const cache = config.cache();
        if (cache && cache.has(code)) {
            svg = cache.get(code);
        } else {
            // This shouldn't happen (already rendered), but handle it
            svg = await config.render(code);
        }

        // Get current board file path
        const currentFilePath = window.currentKanbanFilePath;

        if (!currentFilePath) {
            throw new Error('No kanban file currently open');
        }

        // Send message to backend to save SVG and update markdown
        const message = {
            type: config.messageType,
            filePath: currentFilePath,
            svgContent: svg
        };
        message[config.codeKey] = code;
        vscode.postMessage(message);

        // Button will be updated when file reloads
        button.textContent = '✓ Converting...';
    } catch (error) {
        console.error(`${config.logPrefix} Conversion error:`, error);
        button.disabled = false;
        button.textContent = '❌ Convert Failed';

        setTimeout(() => {
            button.textContent = '💾 Convert to SVG';
        }, 3000);
    }
}

// Legacy wrapper functions for backwards compatibility
function handlePlantUMLConvert(button) {
    return handleDiagramConvert(button, 'plantuml');
}

function handleMermaidConvert(button) {
    return handleDiagramConvert(button, 'mermaid');
}

// Event delegation for convert buttons (wrapped in guard to prevent duplicates on webview revival)
if (!webviewEventListenersInitialized) {
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('plantuml-convert-btn')) {
            handleDiagramConvert(e.target, 'plantuml');
        }

        if (e.target.classList.contains('mermaid-convert-btn')) {
            handleDiagramConvert(e.target, 'mermaid');
        }
    });
}

// ============================================================================
// Menu Configuration
// ============================================================================
// Font size configuration
const fontSizeMultipliers = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];

// Font size CSS classes are now pre-defined in webview.css
// See "Pre-generated Font Size Classes" section

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

// Helper function to convert option value to CSS value
function getCSS(optionType, value) {
    if (!baseOptions[optionType]) {
        return value;
    }
    const option = baseOptions[optionType].find(opt => opt.value === value);
    return option ? option.css : value;
}

// Helper function to convert CSS value back to option value (for legacy support)
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
// Simple generator for most menu types
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

// Make both baseOptions and menuConfig globally accessible
window.baseOptions = baseOptions;
window.menuConfig = menuConfig;
window.getCSS = getCSS;
window.getValue = getValue;

/**
 * SINGLE SOURCE OF TRUTH (Frontend): Creates display title with include badge placeholders
 *
 * This is the FRONTEND mirror of the backend createDisplayTitleWithPlaceholders() function.
 * Both must use the same placeholder format: %INCLUDE_BADGE:filepath%
 *
 * @param {string} title - Raw title containing !!!include(filepath)!!! directives
 * @param {string[]} resolvedFiles - Array of resolved file paths
 * @returns {string} Display title with placeholders
 */
window.createDisplayTitleWithPlaceholders = function(title, resolvedFiles) {
    if (!resolvedFiles || resolvedFiles.length === 0) {
        return title;
    }

    let displayTitle = title;
    const includeRegex = /!!!include\s*\(([^)]+)\)\s*!!!/g;

    resolvedFiles.forEach((filePath, index) => {
        // CRITICAL: This format must match backend IncludeConstants.ts
        const placeholder = `%INCLUDE_BADGE:${filePath}%`;
        displayTitle = displayTitle.replace(includeRegex, placeholder);
    });

    return displayTitle;
};

// Layout Presets Configuration (will be loaded from backend)
let layoutPresets = {};

// Function to get current setting value for menu indicators
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

// Single function to update all menu indicators
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

// Helper function to generate menu HTML from configuration
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

// Function to populate dynamic menus
function populateDynamicMenus() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', populateDynamicMenus);
        return;
    }

    // Use the shared update function
    updateAllMenuIndicators();
}


async function readClipboardContent() {
    try {
        // Check if document is focused (required for clipboard access)
        if (!document.hasFocus()) {
            // Try to focus the window
            window.focus();
            // Wait a moment and try again
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!document.hasFocus()) {
                return null;
            }
        }

        // Check clipboard permissions first
        if (!navigator.clipboard) {
            return null;
        }

        // Check if we have clipboard permissions
        try {
            const permission = await navigator.permissions.query({ name: 'clipboard-read' });
            if (permission.state === 'denied') {
                return null;
            }
        } catch (permError) {
            // Permission check failed, continue anyway
        }

        // First check for clipboard images
        let clipboardItems;
        try {
            clipboardItems = await navigator.clipboard.read();
        } catch (error) {
            // Fall back to text reading
            try {
                const text = await navigator.clipboard.readText();
                if (text && text.trim()) {
                    return await processClipboardText(text.trim());
                }
            } catch (textError) {
                // Clipboard reading failed
            }
            return null;
        }

        for (const clipboardItem of clipboardItems) {
            for (const type of clipboardItem.types) {
                if (type.startsWith('image/')) {
                    let blob;
                    try {
                        blob = await clipboardItem.getType(type);
                    } catch (error) {
                        continue;
                    }

                    // Convert blob to base64 immediately to avoid blob being discarded
                    try {
                        const reader = new FileReader();
                        const base64Promise = new Promise((resolve, reject) => {
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = () => reject(new Error('Failed to read blob as base64'));
                            reader.readAsDataURL(blob);
                        });

                        const base64Data = await base64Promise;

                        // Generate MD5 hash from blob data for consistent filename
                        const arrayBufferReader = new FileReader();
                        const arrayBufferPromise = new Promise((resolve, reject) => {
                            arrayBufferReader.onloadend = () => resolve(arrayBufferReader.result);
                            arrayBufferReader.onerror = () => reject(new Error('Failed to read blob as array buffer'));
                            arrayBufferReader.readAsArrayBuffer(blob);
                        });

                        const arrayBuffer = await arrayBufferPromise;
                        const md5Hash = await generateMD5Hash(arrayBuffer);

                        return {
                            title: 'Clipboard Image',
                            content: base64Data,
                            isLink: false,
                            isImage: true,
                            imageType: type,
                            isBase64: true,
                            md5Hash: md5Hash
                        };
                    } catch (error) {
                        console.error('❌ Failed to convert blob to base64:', error.message);
                        continue;
                    }
                }
            }
        }

        // If no images, check for text
        try {
            const text = await navigator.clipboard.readText();

            if (!text || text.trim() === '') {
                return null;
            }

            return await processClipboardText(text.trim());
        } catch (error) {
            return null;
        }

    } catch (error) {
        // Last resort fallback to text-only clipboard reading
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                return await processClipboardText(text.trim());
            }
        } catch (fallbackError) {
            // All clipboard reading failed
        }

        return null;
    }
}

// File path processing functions now in utils/validationUtils.js

// escapeFilePath function moved to utils/validationUtils.js

function createFileMarkdownLink(filePath) {
    const fileName = filePath.split(/[\/\\]/).pop() || filePath;
    const extension = fileName.toLowerCase().split('.').pop();

    // Image file extensions
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif'];
    // Markdown file extensions
    const markdownExtensions = ['md', 'markdown', 'mdown', 'mkd', 'mdx'];

    if (imageExtensions.includes(extension)) {
        // Image: ![](path) - use URL encoding for spaces and special characters
        const safePath = escapeFilePath(filePath);
        return `![](${safePath})`;
    } else if (markdownExtensions.includes(extension)) {
        // Markdown: [[filename]] - wiki links don't use URL encoding, just escape special chars
        if (filePath.includes('/') || filePath.includes('\\')) {
            const wikiPath = ValidationUtils.escapeWikiLinkPath(filePath);
            return `[[${wikiPath}]]`;
        } else {
            // For simple filenames, also use wiki link escaping
            const wikiFileName = ValidationUtils.escapeWikiLinkPath(fileName);
            return `[[${wikiFileName}]]`;
        }
    } else if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        // URL: <url> - URLs are already encoded
        return `<${filePath}>`;
    } else {
        // Other files: [filename](path) - use URL encoding
        const safePath = escapeFilePath(filePath);
        const baseName = fileName.replace(/\.[^/.]+$/, "");
        return `[${baseName}](${safePath})`;
    }
}

async function processClipboardText(text) {
    // Handle multiple lines - check for multiple file paths first
    const lines = text.split(/\r\n|\r|\n/).map(line => line.trim()).filter(line => line.length > 0);

    if (lines.length > 1) {
        const filePaths = lines.filter(line => isFilePath(line));

        if (filePaths.length > 1) {
            // Multiple file paths - create links for each
            const links = filePaths.map(filePath => createFileMarkdownLink(filePath));
            const content = links.join('\n');

            return {
                title: `${filePaths.length} Files`,
                content: content,
                isLink: true,
                multipleFiles: true
            };
        }
    }

    // Single line processing
    // Check if it's a URL
    const urlRegex = /^https?:\/\/[^\s]+$/;
    if (urlRegex.test(text)) {
        try {
            // Try to fetch title from URL
            const title = await fetchUrlTitle(text);
            return {
                title: title || extractDomainFromUrl(text),
                content: `[${title || extractDomainFromUrl(text)}](${text})`,
                isLink: true
            };
        } catch (error) {
            // Fallback to domain name as title
            return {
                title: extractDomainFromUrl(text),
                content: `[${extractDomainFromUrl(text)}](${text})`,
                isLink: true
            };
        }
    }

    // Check if it's a single file path
    if (isFilePath(text.trim())) {
        const filePath = text.trim();
        const fileName = filePath.split(/[\/\\]/).pop();
        const content = createFileMarkdownLink(filePath);

        return {
            title: fileName,
            content: content,
            isLink: true
        };
    }
    
    // Check if it contains a URL within text
    const urlInTextRegex = /https?:\/\/[^\s]+/g;
    if (urlInTextRegex.test(text)) {
        // Extract title from first line if available
        const lines = text.split('\n');
        const title = lines[0].length > 50 ? lines[0].substring(0, 50) + '...' : lines[0];
        
        return {
            title: title || 'Clipboard Content',
            content: text,
            isLink: false
        };
    }
    
    // Check if content looks like presentation format (has --- slide separators)
    // Look for --- on its own line (with optional whitespace), more permissive than parser
    // This allows pasting as a column with multiple tasks
    const isPresentationFormat = /\n---[ \t]*\n/.test(text);

    // Regular text content
    const textLines = text.split('\n');
    const title = textLines[0].length > 50 ? textLines[0].substring(0, 50) + '...' : textLines[0];

    return {
        title: title || 'Clipboard Content',
        content: text,
        isLink: false,
        isPresentationFormat: isPresentationFormat
    };
}

// isImageFile function now in utils/validationUtils.js

// escapeHtml function moved to utils/validationUtils.js

function extractDomainFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch (error) {
        return 'Link';
    }
}

async function fetchUrlTitle(url) {
    try {
        // Note: This will likely be blocked by CORS in most cases
        // But we'll try anyway, with a fallback to domain name
        const response = await fetch(url, { mode: 'cors' });
        const text = await response.text();
        const titleMatch = text.match(/<title[^>]*>([^<]*)<\/title>/i);
        return titleMatch ? titleMatch[1].trim() : null;
    } catch (error) {
        // CORS will usually block this, so we'll use domain as fallback
        return null;
    }
}

async function updateClipboardCardSource(force = false) {
    // Throttle clipboard reading to avoid over-requesting
    const now = Date.now();
    if (!force && (now - lastClipboardCheck) < CLIPBOARD_CHECK_THROTTLE) {
        // Use cached data
    } else {
        lastClipboardCheck = now;
        // Update clipboard content
        clipboardCardData = await readClipboardContent();
        // Also expose to window for clipboard column handler
        window.clipboardCardData = clipboardCardData;
    }

    const clipboardSource = document.getElementById('clipboard-card-source');
    const clipboardMenuText = document.getElementById('clipboard-menu-text');

    if (clipboardSource) {
        const iconSpan = clipboardSource.querySelector('.drag-menu-item-icon');

        if (clipboardCardData && clipboardCardData.content) {
            clipboardSource.classList.remove('faded');
            const escapedTitle = (typeof escapeHtml === 'function') ? escapeHtml(clipboardCardData.title) : clipboardCardData.title;

            // Show first 20 characters for menu preview
            const rawPreview = clipboardCardData.content.length > 20
                ? clipboardCardData.content.substring(0, 20) + '...'
                : clipboardCardData.content;

            // Escape the preview content to prevent HTML rendering
            const preview = (typeof escapeHtml === 'function') ? escapeHtml(rawPreview) : rawPreview;

            // Update visual indicator based on content type
            let menuLabel = 'Clipboard';
            if (clipboardCardData.isImage) {
                if (iconSpan) iconSpan.textContent = '🖼️';
                menuLabel = 'Image';
            } else if (clipboardCardData.isLink) {
                // Check if it's an image file or URL
                if (clipboardCardData.content.startsWith('![')) {
                    if (iconSpan) iconSpan.textContent = '🖼️';
                    menuLabel = 'Image Link';
                } else if (clipboardCardData.content.startsWith('[')) {
                    if (iconSpan) iconSpan.textContent = '📄';
                    menuLabel = 'File Link';
                } else {
                    if (iconSpan) iconSpan.textContent = '🔗';
                    menuLabel = 'URL';
                }
            } else {
                if (iconSpan) iconSpan.textContent = '📋';
                menuLabel = `"${preview}"`;
            }

            // Update menu text
            if (clipboardMenuText) {
                clipboardMenuText.textContent = menuLabel;
            }
        } else {
            clipboardSource.classList.add('faded');

            if (iconSpan) iconSpan.textContent = '📋';
            if (clipboardMenuText) clipboardMenuText.textContent = 'Clipboard';
        }
    }

    // Update Clipboard Column source visibility
    const clipboardColumnSource = document.getElementById('clipboard-column-source');
    const clipboardColumnText = document.getElementById('clipboard-column-text');
    if (clipboardColumnSource) {
        if (clipboardCardData && clipboardCardData.isPresentationFormat) {
            clipboardColumnSource.classList.remove('faded');
            if (clipboardColumnText) {
                // Count slides in the content
                const slideCount = (clipboardCardData.content.match(/\n\n---\s*\n\n/g) || []).length + 1;
                clipboardColumnText.textContent = `Clipboard Column (${slideCount} tasks)`;
            }
        } else {
            clipboardColumnSource.classList.add('faded');
            if (clipboardColumnText) {
                clipboardColumnText.textContent = 'Clipboard Column';
            }
        }
    }
}

// Function to position file bar dropdown
function positionFileBarDropdown(triggerButton, dropdown) {
    const rect = triggerButton.getBoundingClientRect();
    const dropdownWidth = 200; // Approximate dropdown width
    const dropdownHeight = 400; // Approximate dropdown height
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Position below the button and aligned to the right
    let left = rect.right - dropdownWidth;
    let top = rect.bottom + 4; // Small margin below button
    
    // Adjust if dropdown would go off-screen horizontally
    if (left < 10) {
        left = 10; // Minimum left margin
    }
    if (left + dropdownWidth > viewportWidth) {
        left = viewportWidth - dropdownWidth - 10;
    }
    
    // Adjust if dropdown would go off-screen vertically (unlikely for top bar menu)
    if (top + dropdownHeight > viewportHeight) {
        top = viewportHeight - dropdownHeight - 10;
    }
    
    // Apply the calculated position
    dropdown.style.left = left + 'px';
    dropdown.style.top = top + 'px';
    dropdown.style.right = 'auto';
    dropdown.style.bottom = 'auto';
}

// Function to toggle file bar menu
function toggleFileBarMenu(event, button) {
    event.stopPropagation();
    const menu = button.parentElement;
    const wasActive = menu.classList.contains('active');
    
    // Close all menus
    document.querySelectorAll('.file-bar-menu').forEach(m => {
        m.classList.remove('active');
    });
    document.querySelectorAll('.donut-menu').forEach(m => {
        m.classList.remove('active');
    });
    
    // Toggle this menu
    if (!wasActive) {
        menu.classList.add('active');
        
        // Position the file bar dropdown
        const dropdown = menu.querySelector('.file-bar-menu-dropdown');
        if (dropdown) {
            positionFileBarDropdown(button, dropdown);
            
            // Set up submenu positioning for file bar items with submenus
            dropdown.querySelectorAll('.file-bar-menu-item.has-submenu').forEach(menuItem => {
                // Remove any existing listeners to prevent duplicates
                if (menuItem._submenuPositionHandler) {
                    menuItem.removeEventListener('mouseenter', menuItem._submenuPositionHandler);
                }
                if (menuItem._submenuHideHandler) {
                    menuItem.removeEventListener('mouseleave', menuItem._submenuHideHandler);
                }
                
                // Create and store the handlers
                
                // Add submenu hover handlers to keep it visible
                const submenu = menuItem.querySelector('.file-bar-menu-submenu');
                if (submenu) {
                    // Track hover state more reliably
                    let isSubmenuHovered = false;
                    let isMenuItemHovered = false;
                    
                    const updateSubmenuVisibility = () => {
                        if (isSubmenuHovered || isMenuItemHovered) {
                            submenu.style.setProperty('display', 'block', 'important');
                            submenu.style.setProperty('visibility', 'visible', 'important');
                        } else {
                            setTimeout(() => {
                                if (!isSubmenuHovered && !isMenuItemHovered) {
                                    submenu.style.setProperty('display', 'none', 'important');
                                    submenu.style.setProperty('visibility', 'hidden', 'important');
                                }
                            }, 150);
                        }
                    };
                    
                    // Menu item hover tracking
                    menuItem.addEventListener('mouseenter', () => {
                        isMenuItemHovered = true;

                        // Populate Marp Classes submenu if needed
                        const scope = submenu.dataset.scope;
                        const menu = submenu.dataset.menu;
                        if (menu === 'marpClasses' && scope === 'global') {
                            const availableClasses = window.marpAvailableClasses || [];
                            const activeClasses = window.getMarpClassesForElement
                                ? window.getMarpClassesForElement('global', null, null)
                                : [];

                            let html = '<div class="donut-menu-tags-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 8px; max-width: 350px;">';
                            availableClasses.forEach(className => {
                                const isActive = activeClasses.includes(className);
                                const checkmark = isActive ? '✓ ' : '';
                                html += `
                                    <button class="donut-menu-tag-chip ${isActive ? 'active' : ''}"
                                            onclick="toggleMarpClass('global', null, null, '${className}')"
                                            style="padding: 6px 8px; font-size: 11px; border: 1px solid #666; border-radius: 4px; background: ${isActive ? '#4a90e2' : 'var(--board-background)'}; color: var(--vscode-foreground); cursor: pointer; text-align: left;">
                                        ${checkmark}${className}
                                    </button>
                                `;
                            });
                            html += '</div>';
                            submenu.innerHTML = html;
                        }

                        // Position file bar submenu to the left (it's right-aligned)
                        const rect = menuItem.getBoundingClientRect();

                        // Temporarily show submenu to get its actual dimensions
                        submenu.style.visibility = 'hidden';
                        submenu.style.display = 'block';
                        const submenuRect = submenu.getBoundingClientRect();
                        const submenuWidth = submenuRect.width || 200;
                        
                        // Position to the left of the menu item, aligned with its left edge
                        let left = rect.left - submenuWidth + 1; // 1px overlap for smooth hover
                        let top = rect.top;
                        
                        // Adjust if it would go off-screen
                        if (left < 10) {
                            left = 10;
                        }
                        
                        submenu.style.position = 'fixed';
                        submenu.style.left = left + 'px';
                        submenu.style.top = top + 'px';
                        submenu.style.zIndex = '2147483647';
                        submenu.style.visibility = 'visible';
                        
                        updateSubmenuVisibility();
                    });
                    menuItem.addEventListener('mouseleave', () => {
                        isMenuItemHovered = false;
                        updateSubmenuVisibility();
                    });
                    
                    // Submenu hover tracking  
                    submenu.addEventListener('mouseenter', () => {
                        isSubmenuHovered = true;
                        updateSubmenuVisibility();
                    });
                    submenu.addEventListener('mouseleave', () => {
                        isSubmenuHovered = false;
                        updateSubmenuVisibility();
                    });
                }
            });
        }
    }
}

// Function to set column width
/**
 * Generic helper to apply and save a setting
 * Purpose: DRY helper to reduce duplication in set* functions
 * @param {string} configKey - The configuration key to save
 * @param {any} value - The value to save
 * @param {function} applyFunction - The apply function to call
 * @param {object} options - Optional settings
 * @param {string} options.message - Success message to show user
 * @param {function} options.afterApply - Callback to run after applying
 */
function applyAndSaveSetting(configKey, value, applyFunction, options = {}) {
    // Apply the setting
    applyFunction(value);

    // Store preference
    configManager.setPreference(configKey, value);

    // Update menu indicators
    updateAllMenuIndicators();

    // Close menus
    document.querySelectorAll('.file-bar-menu').forEach(m => {
        m.classList.remove('active');
    });

    // Run optional callback after apply
    if (options.afterApply) {
        options.afterApply();
    }

    // Show success message if provided
    if (options.message) {
        vscode.postMessage({ type: 'showMessage', text: options.message });
    }
}

/**
 * Sets the width of all kanban columns
 * Purpose: Adjust column width for different screen sizes
 * Used by: Column width menu selections
 * @param {string} size - 'narrow', 'medium', 'wide', 'full'
 * Side effects: Updates CSS variables, saves preference
 */
function applyColumnWidth(size, skipRender = false) {
    currentColumnWidth = size;
    window.currentColumnWidth = size;

    // Use styleManager to apply CSS variable - it handles getCSS conversion
    styleManager.applyColumnWidth(size);

    // For viewport-based widths, clear span classes since they conflict with full-width columns
    const isViewportWidth = size.endsWith('percent');
    if (isViewportWidth) {
        const columns = document.querySelectorAll('.kanban-full-height-column');
        columns.forEach(column => {
            column.classList.remove('column-span-2', 'column-span-3', 'column-span-4');
        });
    } else {
        // For pixel widths, re-apply span classes if they exist
        // Trigger a re-render to restore span classes from column titles
        // Skip during initial config to avoid duplicate renders
        if (window.cachedBoard && !skipRender && !window.applyingInitialConfig) {
            renderBoard(window.cachedBoard, { skipRender: false });
        }
    }
}

function setColumnWidth(size) {
    applyAndSaveSetting('columnWidth', size, applyColumnWidth, {
        message: `Column width set to ${size}`
    });
}



// Function to set layout rows
/**
 * Sets the number of rows in the kanban layout
 * Purpose: Switch between single and multi-row layouts
 * Used by: Layout menu selections
 * @param {number} rows - Number of rows (1, 2, or 3)
 * Side effects: Updates board layout, triggers re-render
 */
// Refactored layout rows functions using styleManager
function applyLayoutRows(rows) {
    currentLayoutRows = rows;
    window.currentLayoutRows = rows;

    // Use styleManager to apply CSS variable
    styleManager.applyLayoutRows(rows);

    // Re-render the board to apply row layout (skip during initial config to avoid duplicate renders)
    if (currentBoard && !window.applyingInitialConfig) {
        renderBoard();
    }
}

function setLayoutRows(rows) {
    applyAndSaveSetting('layoutRows', rows, applyLayoutRows, {
        message: `Layout set to ${rows} row${rows > 1 ? 's' : ''}`
    });
}

// Global variable to store current row height
let currentRowHeight = 'auto';

// Function to apply row height to existing rows
function applyRowHeight(height) {
    // Convert value to CSS using getCSS helper
    const cssHeight = getCSS('rowHeight', height);

    const rows = document.querySelectorAll('.kanban-row');
    const boardElement = document.getElementById('kanban-board');
    const isMultiRow = boardElement && boardElement.classList.contains('multi-row');

    rows.forEach((row, index) => {
        if (cssHeight === 'auto') {
            // Auto height - no constraints
            row.style.height = 'auto';
            row.style.minHeight = 'auto';
            row.style.maxHeight = 'none';
            row.style.overflowY = 'visible';
            row.style.overflowX = 'visible';
            
            // Reset individual columns
            row.querySelectorAll('.kanban-full-height-column .column-content').forEach(content => {
                content.style.maxHeight = '';
                content.style.overflowY = 'visible';
            });
        } else {
            // Fixed height - constrain row height but no row scrollbars
            row.style.height = cssHeight;
            row.style.minHeight = cssHeight;
            row.style.maxHeight = cssHeight;
            row.style.overflowY = 'hidden';  // No row scrollbars
            row.style.overflowX = 'visible';  // No horizontal scrollbar on row
            
            // Apply scrollbars to individual column contents
            row.querySelectorAll('.kanban-full-height-column .column-content').forEach(content => {
                const column = content.closest('.kanban-full-height-column');
                if (!column.classList.contains('collapsed')) {
                    // Use CSS calc to determine available height (row height minus estimated header height)
                    // This avoids relying on offsetHeight during rendering
                    const availableHeight = `calc(${height} - 60px)`; // Estimated header height
                    
                    content.style.maxHeight = availableHeight;
                    content.style.overflowY = 'auto';  // Individual column vertical scrollbar
                    content.style.overflowX = 'hidden'; // No horizontal scrollbar on columns
                }
            });
        }
    });
    
    // For single-row layout, also apply height constraints directly to columns
    if (!isMultiRow) {
        const columns = document.querySelectorAll('.kanban-full-height-column');
        columns.forEach(column => {
            const content = column.querySelector('.column-content');
            if (content && !column.classList.contains('collapsed')) {
                if (height === 'auto') {
                    content.style.maxHeight = '';
                    content.style.overflowY = 'visible';
                } else {
                    const availableHeight = `calc(${height} - 60px)`;
                    content.style.maxHeight = availableHeight;
                    content.style.overflowY = 'auto';
                    content.style.overflowX = 'hidden';
                }
            }
        });
    }
}

// Refactored row height functions using styleManager
function applyRowHeightSetting(height) {
    currentRowHeight = height;
    window.currentRowHeight = height;

    // Convert percentage values to viewport units
    let cssValue = height;
    if (height.includes('percent')) {
        const percent = parseInt(height.replace('percent', ''));
        cssValue = `${percent}vh`;
    }

    styleManager.applyRowHeight(cssValue === 'auto' ? 'auto' : cssValue);

    // Call legacy applyRowHeight if it exists
    if (typeof applyRowHeight === 'function') {
        applyRowHeight(height);
    }
}

function setRowHeight(height) {
    applyAndSaveSetting('rowHeight', height, applyRowHeightSetting);
}

// Sticky stack elements functionality
// Sticky stack mode functionality
let currentStickyStackMode = 'titleonly';

function applyStickyStackMode(mode) {
    currentStickyStackMode = mode;
    window.currentStickyStackMode = mode;

    // Remove all mode classes
    document.body.classList.remove('sticky-stack-mode-full', 'sticky-stack-mode-titleonly');

    // Add the appropriate class
    document.body.classList.add(`sticky-stack-mode-${mode}`);
}

function setStickyStackMode(mode) {
    applyAndSaveSetting('stickyStackMode', mode, applyStickyStackMode, {
        afterApply: () => {
            // Recalculate stack positions with new mode
            if (typeof window.applyStackedColumnStyles === 'function') {
                window.applyStackedColumnStyles();
            }
        }
    });
}

// Tag visibility functionality
let currentTagVisibility = 'standard'; // Default to standard (exclude #span and #row)

// Helper function to filter tags from text based on current visibility setting
function filterTagsFromText(text) {
    if (!text) {return text;}

    const setting = currentTagVisibility || 'standard';

    // Always use TagUtils - no fallback
    if (!window.tagUtils || typeof window.tagUtils.filterTagsFromText !== 'function') {
        console.error('[filterTagsFromText] tagUtils not available!');
        return text;
    }

    return window.tagUtils.filterTagsFromText(text, setting);
}

function applyTagVisibility(setting) {
    // Store current setting
    currentTagVisibility = setting;
    window.currentTagVisibility = setting;

    // Remove all tag visibility classes
    document.body.classList.remove('tag-visibility-all', 'tag-visibility-allexcludinglayout', 'tag-visibility-customonly', 'tag-visibility-mentionsonly', 'tag-visibility-none');

    // Add the selected tag visibility class
    document.body.classList.add(`tag-visibility-${setting}`);

    // Trigger re-render to apply text filtering changes (skip during initial config to avoid duplicate renders)
    if (window.cachedBoard && !window.applyingInitialConfig) {
        renderBoard(window.cachedBoard, { skipRender: false });

        // Preserve column width after re-render
        setTimeout(() => {
            if (window.currentColumnWidth && window.applyColumnWidth) {
                window.applyColumnWidth(window.currentColumnWidth, true);
            }
        }, 50);
    }
}

function setTagVisibility(setting) {
    applyAndSaveSetting('tagVisibility', setting, applyTagVisibility);
}

// HTML Comments visibility
function applyHtmlCommentRenderMode(mode) {
    // Store current setting
    window.currentHtmlCommentRenderMode = mode;

    // Update config manager cache if available
    if (window.configManager) {
        window.configManager.cache.set('htmlCommentRenderMode', mode);
    }

    // Trigger re-render to apply changes (skip during initial config to avoid duplicate renders)
    if (window.cachedBoard && !window.applyingInitialConfig) {
        renderBoard(window.cachedBoard, { skipRender: false });

        // Preserve column width after re-render
        setTimeout(() => {
            if (window.currentColumnWidth && window.applyColumnWidth) {
                window.applyColumnWidth(window.currentColumnWidth, true);
            }
        }, 50);
    }
}

function setHtmlCommentRenderMode(mode) {
    applyAndSaveSetting('htmlCommentRenderMode', mode, applyHtmlCommentRenderMode);
}

function applyHtmlContentRenderMode(mode) {
    // Store current setting
    window.currentHtmlContentRenderMode = mode;

    // Update config manager cache if available
    if (window.configManager) {
        window.configManager.cache.set('htmlContentRenderMode', mode);
    }

    // Trigger re-render to apply changes (skip during initial config to avoid duplicate renders)
    if (window.cachedBoard && !window.applyingInitialConfig) {
        renderBoard(window.cachedBoard, { skipRender: false });

        // Preserve column width after re-render
        setTimeout(() => {
            if (window.currentColumnWidth && window.applyColumnWidth) {
                window.applyColumnWidth(window.currentColumnWidth, true);
            }
        }, 50);
    }
}

function setHtmlContentRenderMode(mode) {
    applyAndSaveSetting('htmlContentRenderMode', mode, applyHtmlContentRenderMode);
}

// Arrow key focus scroll setting
let currentArrowKeyFocusScroll = 'center'; // Default to center

// Refactored whitespace functions using styleManager
function applyWhitespace(spacing) {
    currentWhitespace = spacing;
    window.currentWhitespace = spacing;

    // Use styleManager to apply CSS variable
    styleManager.applyWhitespace(spacing);

    // Call legacy updateWhitespace if it exists for compatibility
    if (typeof updateWhitespace === 'function') {
        updateWhitespace(spacing);
    }

    // Update border styles
    if (typeof updateBorderStyles === 'function') {
        updateBorderStyles();
    }
}

function setWhitespace(spacing) {
    applyAndSaveSetting('whitespace', spacing, applyWhitespace);
}

// Refactored task min height functions using styleManager
function applyTaskMinHeight(height) {
    currentTaskMinHeight = height;
    window.currentTaskMinHeight = height;

    // Use styleManager to apply card height
    styleManager.applyCardHeight(height);

    // Call legacy updateTaskMinHeight if it exists for compatibility
    if (typeof updateTaskMinHeight === 'function') {
        updateTaskMinHeight(height);
    }
}

function setTaskMinHeight(height) {
    applyAndSaveSetting('taskMinHeight', height, applyTaskMinHeight);
}

// Section height functions
function applySectionHeight(height) {
    window.currentSectionHeight = height;

    // Use styleManager to apply section height
    styleManager.applySectionHeight(height);
}

function setSectionHeight(height) {
    applyAndSaveSetting('sectionHeight', height, applySectionHeight);
}

// Task section height functions
function applyTaskSectionHeight(height) {
    window.currentTaskSectionHeight = height;

    // Use styleManager to apply task section height
    styleManager.applyTaskSectionHeight(height);
}

function setTaskSectionHeight(height) {
    applyAndSaveSetting('taskSectionHeight', height, applyTaskSectionHeight);
}

// Function to detect row tags from board
/**
 * Auto-detects number of rows from column tags
 * Purpose: Determine layout from #row tags in columns
 * Used by: Board initialization and updates
 * @param {Object} board - Board data object
 * @returns {number} Detected number of rows
 */
function detectRowsFromBoard(board) {
    if (!board || !board.columns) {return 1;}

    let maxRow = 1;
    board.columns.forEach(column => {
        if (column.title) {
            // Look for #row{number} format only (hashtag required)
            const rowMatch = column.title.match(/#row(\d+)/i);
            if (rowMatch) {
                const rowNum = parseInt(rowMatch[1]);
                if (rowNum > maxRow) {
                    maxRow = rowNum;
                }
            }
        }
    });

    return maxRow; // No cap - support unlimited rows
}

// Function to get column row from title
function getColumnRow(title) {
    if (!title) {return 1;}

    // More comprehensive regex to find row tags
    const rowMatches = title.match(/#row(\d+)\b/gi);
    if (rowMatches && rowMatches.length > 0) {
        // Get the last match in case there are multiple (shouldn't happen, but just in case)
        const lastMatch = rowMatches[rowMatches.length - 1];
        const rowNum = parseInt(lastMatch.replace(/#row/i, ''));
        return Math.max(rowNum, 1); // No upper limit - support unlimited rows
    }
    return 1;
}

/**
 * Sort columns by row number, maintaining original order within each row
 * Mirrors the backend sortColumnsByRow() function from columnUtils.ts
 * @param {Array} columns - Array of columns with title property
 * @returns {Array} Sorted array of columns (row 1 first, then row 2, etc.)
 */
function sortColumnsByRow(columns) {
    if (!columns || !Array.isArray(columns)) return columns;
    return columns
        .map((column, index) => ({
            column,
            index,
            row: getColumnRow(column.title)
        }))
        .sort((a, b) => {
            // First sort by row number
            if (a.row !== b.row) {
                return a.row - b.row;
            }
            // Within same row, maintain original order
            return a.index - b.index;
        })
        .map(item => item.column);
}

// Function to update column row tag
function updateColumnRowTag(columnId, newRow) {
    if (!currentBoard || !currentBoard.columns) {return;}

    const column = currentBoard.columns.find(c => c.id === columnId);
    if (!column) {return;}

    // Also update cachedBoard if it exists and is different
    let cachedColumn = null;
    if (window.cachedBoard && window.cachedBoard !== currentBoard) {
        cachedColumn = window.cachedBoard.columns.find(c => c.id === columnId);
    }
    
    // Remove ALL existing row tags - more comprehensive regex patterns
    let cleanTitle = column.title
        .replace(/#row\d+\b/gi, '')  // Remove #row followed by digits
        .replace(/\s+#row\d+/gi, '')  // Remove with preceding space
        .replace(/#row\d+\s+/gi, '')  // Remove with following space
        .replace(/\s+#row\d+\s+/gi, '');  // Remove with following and preceding space
    
    // Update the column title
    if (newRow > 1) {
        // Add row tag for rows 2, 3, 4
        // Ensure space before #row tag if title is not empty
        column.title = cleanTitle ? cleanTitle + ` #row${newRow}` : ` #row${newRow}`;
        if (cachedColumn) {
            cachedColumn.title = cleanTitle ? cleanTitle + ` #row${newRow}` : ` #row${newRow}`;
        }
    } else {
        // For row 1, just use the clean title without any row tag
        column.title = cleanTitle;
        if (cachedColumn) {
            cachedColumn.title = cleanTitle;
        }
    }
    
    // Update the visual element immediately
    const columnElement = document.querySelector(`[data-column-id="${columnId}"]`)?.closest('.kanban-full-height-column');
    if (columnElement) {
        columnElement.setAttribute('data-row', newRow);
        
        // Update the displayed title using shared function
        const titleElement = columnElement.querySelector('.column-title-text');
        if (titleElement) {
            const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(column, window.filterTagsFromText) : (column.title || '');
            titleElement.innerHTML = renderedTitle;
        }
        
        // Update the edit textarea
        const editElement = columnElement.querySelector('.column-title-edit');
        if (editElement) {
            editElement.value = column.title;
        }
    }
    
    // CRITICAL: Get current column ID by POSITION from currentBoard (source of truth)
    // DOM might have stale IDs if a boardUpdate just arrived
    let currentColumnId = columnId; // Default to what we have

    // Find column's position in DOM to match with current board
    if (columnElement) {
        const allColumns = Array.from(document.querySelectorAll('.kanban-full-height-column'));
        const columnIndex = allColumns.indexOf(columnElement);

        if (columnIndex !== -1 && window.currentBoard?.columns?.[columnIndex]) {
            // Match by position - use current ID from board at this position
            currentColumnId = window.currentBoard.columns[columnIndex].id;
        }
    }

    // Send update to backend with the full title including row tag
    vscode.postMessage({
        type: 'editColumnTitle',
        columnId: currentColumnId,
        title: column.title
    });
}

// Function to clean up any duplicate or invalid row tags
function cleanupRowTags() {
    if (!currentBoard || !currentBoard.columns) {return;}
    
    let needsUpdate = false;
    
    currentBoard.columns.forEach(column => {
        const originalTitle = column.title;
        
        // Find all row tags
        const rowTags = column.title.match(/#row\d+\b/gi) || [];
        
        if (rowTags.length > 1) {
            // Remove all row tags first
            let cleanTitle = column.title;
            rowTags.forEach(tag => {
                cleanTitle = cleanTitle.replace(new RegExp(tag, 'gi'), '');
            });
            cleanTitle = cleanTitle.replace(/\s{2,}/g, ' ').trim();
            
            // Add back only the last tag
            const lastTag = rowTags[rowTags.length - 1];
            column.title = cleanTitle + ' ' + lastTag;
            
            if (column.title !== originalTitle) {
                needsUpdate = true;
            }
        }
    });
    
    if (needsUpdate) {
        // Trigger a board update if we made changes
        renderBoard();
    }
}


document.addEventListener('DOMContentLoaded', () => {
    // MEMORY SAFETY: Skip initialization if already done (prevents duplicate listeners on webview revival)
    if (webviewEventListenersInitialized) {
        // Still send ready message and setup drag/drop (idempotent operations)
        vscode.postMessage({ type: 'webviewReady' });
        vscode.postMessage({ type: 'requestFileInfo' });
        setupDragAndDrop();
        return;
    }
    webviewEventListenersInitialized = true;

    // Request available Marp classes on load
    vscode.postMessage({
        type: 'getMarpAvailableClasses'
    });

    // Theme observer is set up later in the file

    // Initialize clipboard card source - handled by HTML ondragstart/ondragend attributes

    // Populate dynamic menus
    populateDynamicMenus();

    // Initialize border styles from config
    updateBorderStyles();

    // Update clipboard content when window gets focus
    window.addEventListener('focus', async () => {
        // Wait a moment for focus to be fully established
        setTimeout(async () => {
            await updateClipboardCardSource(true); // Force update on focus
        }, 100);
    });
    
    // Function to auto-save pending changes
    function autoSavePendingChanges() {
        // CRITICAL FIX: Do NOT auto-save if user is actively editing
        // This prevents auto-save from setting skip flag when user switches to external editor,
        // which would cause external saves to be incorrectly treated as "our own save"
        if (window.taskEditor && window.taskEditor.currentEditor !== null) {
            return;
        }

        const pendingColumnCount = window.pendingColumnChanges?.size || 0;
        const pendingTaskCount = window.pendingTaskChanges?.size || 0;
        const totalPending = pendingColumnCount + pendingTaskCount;
        
        if (totalPending > 0) {
            
            // Send all pending column changes
            if (window.pendingColumnChanges && window.pendingColumnChanges.size > 0) {
                window.pendingColumnChanges.forEach((change) => {
                    vscode.postMessage({
                        type: 'editColumnTitle',
                        columnId: change.columnId,
                        title: change.title
                    });
                });
                window.pendingColumnChanges.clear();
            }
            
            // Note: Task changes are now sent immediately when edits end, not batched here
            // Only column changes are batched and sent on window blur
            // Clear any stale task changes if they exist (shouldn't happen normally)
            if (window.pendingTaskChanges && window.pendingTaskChanges.size > 0) {
                console.warn('[webview] Found pending task changes on window blur - this should not happen as tasks send immediately');
                window.pendingTaskChanges.clear();
            }
            
            // Update button state
            if (window.updateRefreshButtonState) {
                window.updateRefreshButtonState('default');
            }
        }
    }
    
    // Auto-save pending changes when losing focus
    // But delay to avoid saving when just switching views briefly
    window.addEventListener('blur', () => {
        
        // Wait a bit to see if focus returns quickly (view switching)
        setTimeout(() => {
            if (document.hidden || !document.hasFocus()) {
                autoSavePendingChanges();
            }
        }, 100);
    });
    
    // Also handle visibility change (tab switching, alt-tabbing)
    // Use same delayed approach to avoid auto-save during quick view switches
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Wait a bit to see if visibility returns quickly (view switching)
            setTimeout(() => {
                if (document.hidden && !closePromptActive) {
                    autoSavePendingChanges();
                }
            }, 100);
        } else {
            // Page became visible - request configuration refresh from backend
            // This handles alt-tabbing back, switching views, etc.
            vscode.postMessage({ type: 'requestConfigurationRefresh' });
        }
    });
    
    // Handle page unload/refresh
    window.addEventListener('beforeunload', (e) => {
        const pendingCount = (window.pendingColumnChanges?.size || 0) + (window.pendingTaskChanges?.size || 0);
        if (pendingCount > 0) {
            autoSavePendingChanges();
            // Note: We can't reliably prevent unload in VS Code webviews,
            // but we try to save synchronously before the page closes
        }
    });
    
    // Listen for copy events to update clipboard
    document.addEventListener('copy', async (e) => {
        // Wait a bit for the clipboard to be updated
        setTimeout(async () => {
            await updateClipboardCardSource(true); // Force update after copy
        }, 100);
    });

    // Listen for Cmd/Ctrl+C to update clipboard (backup)
    document.addEventListener('keydown', async (e) => {
        // Check for Cmd+C (Mac) or Ctrl+C (Windows/Linux)
        if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
            // Wait a bit for the clipboard to be updated
            setTimeout(async () => {
                await updateClipboardCardSource(true); // Force update after copy
            }, 200);
        }
    });
    
    // Initial clipboard check
    setTimeout(async () => {
        await updateClipboardCardSource();
    }, 1000); // Delay to ensure everything is initialized

    // Add click handler to read clipboard (user interaction required for clipboard API)
    const clipboardSource = document.getElementById('clipboard-card-source');
    if (clipboardSource) {
        clipboardSource.addEventListener('click', async () => {
            // Manual update on click
            await updateClipboardCardSource(true); // Force update on click
        });
    }
 
    // Global Alt+click handler for links/images (as fallback)
    document.addEventListener('click', (e) => {
        // Only handle Alt+click for opening links/images
        if (!e.altKey) {return;}
        
        // Check if we're in a kanban element that has its own handler
        if (e.target.closest('.column-title') || 
            e.target.closest('.task-title-container') || 
            e.target.closest('.task-description-container')) {
            return; // Let the specific handlers deal with it
        }
        
        // For other areas, handle Alt+click to open
        window.handleLinkOrImageOpen && window.handleLinkOrImageOpen(e, e.target);
    }, false);

    // Close menus when clicking outside (but don't interfere with editing)
    document.addEventListener('click', (e) => {
        // Check if clicking outside menus - also check if clicking inside moved dropdowns
        const inDonutMenu = e.target.closest('.donut-menu');
        const inFileBarMenu = e.target.closest('.file-bar-menu');
        const inMovedDropdown = e.target.closest('.donut-menu-dropdown.moved-to-body, .file-bar-menu-dropdown.moved-to-body');

        if (!inDonutMenu && !inFileBarMenu && !inMovedDropdown) {
            // Close all menus and clean up moved dropdowns
            document.querySelectorAll('.donut-menu').forEach(menu => {
                menu.classList.remove('active');
                // Clean up moved dropdowns - check both in menu and moved to body
                let dropdown = menu.querySelector('.donut-menu-dropdown');
                if (!dropdown && typeof cleanupDropdown === 'function') {
                    // Look for moved dropdowns in body that belong to this menu
                    const movedDropdowns = document.body.querySelectorAll('.donut-menu-dropdown.moved-to-body');
                    dropdown = Array.from(movedDropdowns).find(d => d._originalParent === menu);
                }
                if (dropdown && typeof cleanupDropdown === 'function') {
                    cleanupDropdown(dropdown);
                }
            });
            document.querySelectorAll('.file-bar-menu').forEach(menu => {
                menu.classList.remove('active');
                // Clean up moved dropdowns - check both in menu and moved to body  
                let dropdown = menu.querySelector('.file-bar-menu-dropdown');
                if (!dropdown && typeof cleanupDropdown === 'function') {
                    // Look for moved dropdowns in body that belong to this menu
                    const movedDropdowns = document.body.querySelectorAll('.file-bar-menu-dropdown.moved-to-body');
                    dropdown = Array.from(movedDropdowns).find(d => d._originalParent === menu);
                }
                if (dropdown && typeof cleanupDropdown === 'function') {
                    cleanupDropdown(dropdown);
                }
            });
        }
    });

    // Modal event listeners
    document.getElementById('input-modal').addEventListener('click', e => {
        if (e.target.id === 'input-modal') {
            closeInputModal();
        }
    });

    // Notify backend that webview is ready to receive messages
    // This implements request-response pattern - backend queues board updates until this is received
    vscode.postMessage({ type: 'webviewReady' });
    vscode.postMessage({ type: 'requestFileInfo' });

    // Setup drag and drop
    setupDragAndDrop();
});

// Helper function to check if we're currently in editing mode
function isCurrentlyEditing() {
    return window.taskEditor && window.taskEditor.currentEditor && 
           window.taskEditor.currentEditor.element && 
           window.taskEditor.currentEditor.element.style.display !== 'none';
}

// Callback for when board rendering is complete
window.onBoardRenderingComplete = function() {
    if (window.pendingFocusTargets && window.pendingFocusTargets.length > 0) {
        
        // Try to find the first target element
        const target = window.pendingFocusTargets[0];
        let element = null;
        
        if (target.type === 'column') {
            element = document.querySelector(`[data-column-id="${target.id}"]`);
        } else if (target.type === 'task') {
            element = document.querySelector(`[data-task-id="${target.id}"]`);
        }
        
        
        if (element) {
            // Element exists - process focus targets and clear them
            handleFocusAfterUndoRedo(window.pendingFocusTargets);
            window.pendingFocusTargets = null;
        }
        // If element not found, keep targets for next render completion
    }
};

// Function to handle focusing on objects after undo/redo
function handleFocusAfterUndoRedo(focusTargets) {
    if (!focusTargets || focusTargets.length === 0) {
        return;
    }
    
    // First pass: Check for any columns that need unfolding
    const columnsToUnfold = new Set();
    focusTargets.forEach(target => {
        if (target.type === 'task') {
            const taskElement = document.querySelector(`[data-task-id="${target.id}"]`);
            if (taskElement) {
                const columnElement = taskElement.closest('[data-column-id]');
                if (columnElement && columnElement.classList.contains('collapsed')) {
                    const columnId = columnElement.getAttribute('data-column-id');
                    columnsToUnfold.add(columnId);
                }
            }
        }
    });

    // Unfold any collapsed columns first
    if (columnsToUnfold.size > 0) {
        if (typeof unfoldColumnIfCollapsed === 'function') {
            columnsToUnfold.forEach(columnId => {
                unfoldColumnIfCollapsed(columnId);
            });
        }
        
        // Wait for unfolding animation to complete before focusing
        setTimeout(() => {
            performFocusActions(focusTargets);
        }, 300); // Allow time for unfolding animation
    } else {
        // No unfolding needed, focus immediately
        performFocusActions(focusTargets);
    }
}

// Helper function to perform the actual focus actions
function performFocusActions(focusTargets) {
    
    // Process all focus targets to handle multiple changes
    focusTargets.forEach((target, index) => {
        let element = null;
        
        if (target.type === 'column') {
            element = document.querySelector(`[data-column-id="${target.id}"]`);
        } else if (target.type === 'task') {
            element = document.querySelector(`[data-task-id="${target.id}"]`);
        }
        
        
        if (element && index === 0) {
            // Only scroll to and highlight the first target to avoid jarring jumps
            // Scroll to element with proper horizontal scrolling for right-side elements
            element.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center',
                inline: 'center'  // Changed from 'nearest' to 'center' for better right-side visibility
            });
            
            // Add highlight effect
            element.classList.add('focus-highlight');
            
            // Remove highlight after animation
            setTimeout(() => {
                element.classList.remove('focus-highlight');
            }, 2000);
        } else if (element) {
            // For additional targets, just add highlight without scrolling
            element.classList.add('focus-highlight');
            setTimeout(() => {
                element.classList.remove('focus-highlight');
            }, 2000);
        }
    });
}

// Clear card focus on click (wrapped in guard)
if (!webviewEventListenersInitialized) {
    document.addEventListener('click', (e) => {
        // Don't clear focus if clicking on a card
        if (!e.target.closest('.task-item') && window.getCurrentFocusedCard()) {
            window.focusCard(null);
        }
    });

    // Handle collapse toggle clicks with event delegation
    document.addEventListener('click', (e) => {
        const collapseToggle = e.target.closest('.collapse-toggle');
        if (collapseToggle) {
            const columnId = collapseToggle.getAttribute('data-column-id');
            if (columnId && typeof window.toggleColumnCollapse === 'function') {
                window.toggleColumnCollapse(columnId, e);
            }
        }
    });

    // Listen for messages from the extension
    window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
        case 'batch':
            // Handle batched messages from backend (via WebviewBridge.sendBatched)
            if (message.messages && Array.isArray(message.messages)) {
                for (const batchedMessage of message.messages) {
                    // Re-dispatch each batched message through this same handler
                    window.dispatchEvent(new MessageEvent('message', {
                        data: batchedMessage,
                        origin: event.origin
                    }));
                }
            }
            break;
        case 'boardUpdate':
            const previousBoard = window.cachedBoard;

            // Clear card focus when board is updated
            focusCard(null);

            // Initialize cache system - this is the SINGLE source of truth
            const isInitialLoad = !window.cachedBoard;
            const isFullRefresh = message.isFullRefresh;
            if (isInitialLoad || isFullRefresh) {
                window.cachedBoard = JSON.parse(JSON.stringify(message.board)); // Deep clone - SINGLE source of truth
                window.savedBoardState = JSON.parse(JSON.stringify(message.board)); // Reference for unsaved detection
                window.hasUnsavedChanges = false;
            } else {
                // Always update the cached board when receiving updates from backend
                window.cachedBoard = JSON.parse(JSON.stringify(message.board));

                // Re-apply pending column changes to preserve local edits
                if (window.pendingColumnChanges && window.pendingColumnChanges.size > 0) {
                    window.pendingColumnChanges.forEach((change, columnId) => {
                        const column = window.cachedBoard.columns.find(c => c.id === columnId);
                        if (column) {
                            column.title = change.title;
                        }
                    });
                }

                // If this is a save confirmation (no unsaved changes), update the saved reference
                if (!window.hasUnsavedChanges) {
                    window.savedBoardState = JSON.parse(JSON.stringify(message.board));
                }

                // For undo/redo operations, update the saved state reference but preserve pending changes
                // Pending changes represent ongoing user edits that should persist through undo operations
                if (message.isUndo || message.isRedo) {
                    window.savedBoardState = JSON.parse(JSON.stringify(message.board));
                    // Note: We intentionally do NOT clear pending changes here, as they represent
                    // valid user modifications that should persist through undo/redo operations
                }
            }
            currentBoard = window.cachedBoard;
            window.currentBoard = currentBoard; // Expose to window for debug overlay verification

            // Clean up any duplicate row tags
            cleanupRowTags();

            // Update version display if provided
            if (message.version) {
                const versionElement = document.getElementById('build-version');
                if (versionElement) {
                    versionElement.textContent = message.version;
                }
            }

            // Prevent renderBoard() calls during initial config application
            // Each apply* function checks this flag and skips its internal renderBoard() call
            // Set this early before any apply* functions are called
            if (isInitialLoad) {
                window.applyingInitialConfig = true;
            }

            // First apply configuration (as fallback)
            if (message.layoutRows) {
                applyLayoutRows(message.layoutRows);
            } else {
                applyLayoutRows(1); // Default fallback
            }

            // Then detect rows from board and override configuration if different
            const detectedRows = detectRowsFromBoard(currentBoard);
            if (detectedRows !== currentLayoutRows) {
                setLayoutRows(detectedRows);
            }

            // Only apply configuration settings on initial load, not on content updates
            if (isInitialLoad) {
                // Initialize global reference to current values
                window.currentColumnWidth = currentColumnWidth;
                // Update whitespace with the value from configuration
                if (message.whitespace) {
                    // Handle legacy whitespace values
                    let whitespace = message.whitespace;
                    if (whitespace === '2px') {
                        whitespace = '4px'; // Convert old compact to new compact
                    } else if (whitespace === '10px') {
                        whitespace = '12px'; // Convert old 10px to comfortable
                    } else if (whitespace === '20px') {
                        whitespace = '24px'; // Convert old 20px to large
                    } else if (whitespace === '40px') {
                        whitespace = '36px'; // Convert old 40px to extra large
                    } else if (whitespace === '60px') {
                        whitespace = '48px'; // Convert old 60px to maximum
                    }
                    applyWhitespace(whitespace);
                } else {
                    applyWhitespace('8px'); // Default fallback
                }

                // Update task min height with the value from configuration
                if (message.taskMinHeight) {
                    // Handle legacy card height values - convert CSS back to value
                    const taskMinHeight = getValue('cardHeight', message.taskMinHeight);
                    applyTaskMinHeight(taskMinHeight);
                } else {
                    applyTaskMinHeight('auto'); // Default fallback
                }

                // Update section height with the value from configuration
                if (message.sectionHeight) {
                    applySectionHeight(message.sectionHeight);
                } else {
                    applySectionHeight('auto'); // Default fallback
                }

                // Update task section height with the value from configuration
                if (message.taskSectionHeight) {
                    applyTaskSectionHeight(message.taskSectionHeight);
                } else {
                    applyTaskSectionHeight('auto'); // Default fallback
                }

                // Update font size with the value from configuration
                if (message.fontSize) {
                    // Handle legacy font size values
                    let fontSize = message.fontSize;
                    if (fontSize === 'small') {
                        fontSize = '0_75x'; // Convert legacy 'small' to 0.75x
                    } else if (fontSize === 'normal') {
                        fontSize = '1x'; // Convert legacy 'normal' to 1x
                    }
                    applyFontSize(fontSize);
                } else {
                    applyFontSize('1x'); // Default fallback
                }

                // Update layout presets from configuration
                if (message.layoutPresets) {
                    layoutPresets = message.layoutPresets;
                    initializeLayoutPresetsMenu(); // Reinitialize menu with new presets
                }

                // Update layout preset from configuration
                if (message.layoutPreset) {
                    window.currentLayoutPreset = message.layoutPreset;
                    updateLayoutPresetsActiveState();
                } else {
                    window.currentLayoutPreset = 'normal'; // Default fallback
                    updateLayoutPresetsActiveState();
                }

                // Update font family with the value from configuration
                if (message.fontFamily) {
                    applyFontFamily(message.fontFamily);
                } else {
                    applyFontFamily('system'); // Default fallback
                }

                // Store border configuration from extension
                if (message.columnBorder && message.taskBorder) {
                    window.borderConfig = {
                        columnBorder: message.columnBorder,
                        taskBorder: message.taskBorder
                    };
                    updateBorderStyles();
                }

                // Update column width with the value from configuration
                if (message.columnWidth) {
                    // Handle legacy column width values
                    let columnWidth = message.columnWidth;
                    if (columnWidth === 'small') {
                        columnWidth = '250px';
                    } else if (columnWidth === 'medium') {
                        columnWidth = '350px';
                    } else if (columnWidth === 'wide') {
                        columnWidth = '450px';
                    } else if (columnWidth === '40') {
                        columnWidth = '33percent';
                    } else if (columnWidth === '66') {
                        columnWidth = '50percent';
                    } else if (columnWidth === '100') {
                        columnWidth = '100percent';
                    }
                    applyColumnWidth(columnWidth);
                } else {
                    applyColumnWidth('350px'); // Default fallback
                }
            }
            
            // Layout rows are now handled above (with auto-detection override)
            
            // Continue configuration settings only on initial load
            if (isInitialLoad) {
                // Update row height with the value from configuration
                if (message.rowHeight) {
                    // Handle legacy row height values - convert CSS back to value
                    let rowHeight = message.rowHeight;
                    // Map legacy em values
                    if (rowHeight === '19em') {
                        rowHeight = '300px';
                    } else if (rowHeight === '31em') {
                        rowHeight = '500px';
                    } else if (rowHeight === '44em') {
                        rowHeight = '700px';
                    } else {
                        rowHeight = getValue('rowHeight', rowHeight);
                    }

                    applyRowHeightSetting(rowHeight);
                } else {
                    applyRowHeightSetting('auto'); // Default fallback
                }

                // Update sticky stack mode with value from configuration
                if (message.stickyStackMode) {
                    applyStickyStackMode(message.stickyStackMode);
                } else {
                    applyStickyStackMode('titleonly'); // Default fallback
                }

                // Update tag visibility with the value from configuration
                if (message.tagVisibility) {
                    // Handle legacy tag visibility values
                    let tagVisibility = message.tagVisibility;
                    if (tagVisibility === 'standard') {
                        tagVisibility = 'allexcludinglayout';
                    } else if (tagVisibility === 'custom') {
                        tagVisibility = 'customonly';
                    } else if (tagVisibility === 'mentions') {
                        tagVisibility = 'mentionsonly';
                    }
                    applyTagVisibility(tagVisibility);
                } else {
                    applyTagVisibility('allexcludinglayout'); // Default fallback
                }

                // Update HTML rendering modes with values from configuration
                if (message.htmlCommentRenderMode !== undefined) {
                    applyHtmlCommentRenderMode(message.htmlCommentRenderMode);
                } else {
                    applyHtmlCommentRenderMode('hidden'); // Default fallback
                }

                if (message.htmlContentRenderMode !== undefined) {
                    applyHtmlContentRenderMode(message.htmlContentRenderMode);
                } else {
                    applyHtmlContentRenderMode('html'); // Default fallback
                }

                // Update arrow key focus scroll with the value from configuration
                if (message.arrowKeyFocusScroll) {
                    currentArrowKeyFocusScroll = message.arrowKeyFocusScroll;
                    window.currentArrowKeyFocusScroll = message.arrowKeyFocusScroll;
                } else {
                    currentArrowKeyFocusScroll = 'center'; // Default fallback
                    window.currentArrowKeyFocusScroll = 'center';
                }

                // Update all menu indicators after settings are applied
                updateAllMenuIndicators();

                // Request available templates on initial load
                if (typeof requestTemplates === 'function') {
                    requestTemplates();
                }

                // Clear the flag - configuration application is complete
                window.applyingInitialConfig = false;
            }

            // Update max row height
            if (typeof message.maxRowHeight !== 'undefined') {
                updateMaxRowHeight(message.maxRowHeight);
            }

            // Check if we should skip rendering (for direct DOM updates like tag changes)
            const shouldSkipRender = message.skipRender || message.board?.skipRender;

            // Store tag colors globally - THIS IS CRITICAL
            // Set from backend message - this populates actual tag configurations
            if (message.tagColors) {
                window.tagColors = message.tagColors;

                // Only apply styles if not skipping render (prevents style spam during tag operations)
                if (!shouldSkipRender && typeof applyTagStyles === 'function') {
                    applyTagStyles();
                }
            } else if (!window.tagColors) {
                // Fallback: initialize to empty object only if backend didn't send it
                window.tagColors = {};
            }

            // Store enabled tag categories for menu filtering
            if (message.enabledTagCategoriesColumn !== undefined) {
                window.enabledTagCategoriesColumn = message.enabledTagCategoriesColumn;
            }
            if (message.enabledTagCategoriesTask !== undefined) {
                window.enabledTagCategoriesTask = message.enabledTagCategoriesTask;
            }

            // Merge custom tag categories into tagColors
            if (message.customTagCategories && Object.keys(message.customTagCategories).length > 0) {
                window.tagColors = window.tagColors || {};
                Object.assign(window.tagColors, message.customTagCategories);
            }

            // Save folding state before re-render
            saveCurrentFoldingState();
            const isEditing = window.taskEditor && window.taskEditor.currentEditor;


            if (!isEditing && !shouldSkipRender) {
                // Only render if not editing and not explicitly skipping
                if (typeof window.renderBoard === 'function') {
                    window.renderBoard();
                }
                
                // Apply default folding if this is from an external change
                if (message.applyDefaultFolding) {
                    setTimeout(() => {
                        applyDefaultFoldingToNewDocument();
                    }, 100); // Wait for render to complete
                }
            }
            break;
        case 'updateFileInfo':
            const previousDocumentPath = currentFileInfo?.documentPath;
            currentFileInfo = message.fileInfo;
            
            // Set current file path for export functions
            if (currentFileInfo && currentFileInfo.documentPath) {
                window.currentFilePath = currentFileInfo.documentPath;
                window.currentKanbanFilePath = currentFileInfo.documentPath; // For PlantUML conversion
            }
            
            // Only update document URI if it actually changed
            if (currentFileInfo && currentFileInfo.documentPath && 
                currentFileInfo.documentPath !== previousDocumentPath) {
                updateDocumentUri(currentFileInfo.documentPath);
            }
            
            updateFileInfoBar();
            break;
        case 'resetClosePromptFlag':
            closePromptActive = false;
            break;
        case 'saveCompleted':
            // Backend has confirmed save is complete, update frontend UI
            if (typeof markSavedChanges === 'function') {
                markSavedChanges();
            }
            break;
        case 'undoRedoStatus':
            canUndo = message.canUndo;
            canRedo = message.canRedo;
            updateUndoRedoButtons();
            break;
        case 'insertFileLink':
            insertFileLink(message.fileInfo);
            break;
        case 'saveError':
            if (typeof handleSaveError === 'function') {
                handleSaveError(message.error);
            } else {
                console.error('❌ handleSaveError function not available:', message.error);
            }
            break;
        case 'checkUnsavedChanges':
            
            const hasChanges = typeof hasUnsavedChanges === 'function' ? hasUnsavedChanges() : false;
                
            // Respond with current unsaved changes status
            vscode.postMessage({
                type: 'hasUnsavedChangesResponse',
                hasUnsavedChanges: hasChanges,
                requestId: message.requestId
            });
            break;
        case 'saveWithConflictFilename':
            // Save current cached board to conflict file
            if (typeof saveCachedBoard === 'function') {
                saveCachedBoard(message.conflictPath);
            } else {
                console.error('❌ saveCachedBoard function not available');
            }
            break;
        case 'requestCachedBoard':
            // Send the current cached board back to the backend
            if (window.cachedBoard || window.cachedBoard) {
                vscode.postMessage({
                    type: 'markUnsavedChanges',
                    hasUnsavedChanges: window.hasUnsavedChanges || false,
                    cachedBoard: window.cachedBoard || window.cachedBoard
                });
            }
            break;
        case 'updateShortcuts':
            // Cache shortcuts for taskEditor to use
            window.cachedShortcuts = message.shortcuts || {};
            break;

        case 'configurationUpdate': {
            // ⚠️ CONFIGURATION REFRESH - Cache all workspace settings
            // This is called on view focus and initial load to ensure fresh configuration
            const configData = message.config || {};

            // Store all configuration in window.cachedConfig for global access
            window.cachedConfig = configData;

            // Apply tag category settings to window properties for menu generation
            if (configData.enabledTagCategoriesColumn !== undefined) {
                window.enabledTagCategoriesColumn = configData.enabledTagCategoriesColumn;
            }
            if (configData.enabledTagCategoriesTask !== undefined) {
                window.enabledTagCategoriesTask = configData.enabledTagCategoriesTask;
            }

            // Merge custom tag categories into tagColors
            if (configData.customTagCategories && Object.keys(configData.customTagCategories).length > 0) {
                window.tagColors = window.tagColors || {};
                Object.assign(window.tagColors, configData.customTagCategories);
            }

            // Apply tag colors if they changed
            if (configData.tagColors && Object.keys(configData.tagColors).length > 0) {
                window.tagColors = window.tagColors || {};
                Object.assign(window.tagColors, configData.tagColors);
                if (typeof applyTagStyles === 'function') {
                    applyTagStyles();
                }
            }

            // Regenerate burger menus with updated tag categories
            // This updates the tag menu items without a full board re-render
            if (typeof window.regenerateAllBurgerMenus === 'function') {
                window.regenerateAllBurgerMenus();
            }
            break;
        }
        case 'unfoldColumnsBeforeUpdate':
            // Unfold columns immediately before board update happens
            if (typeof unfoldColumnIfCollapsed === 'function') {
                message.columnIds.forEach(columnId => {
                    unfoldColumnIfCollapsed(columnId);
                });
            }

            // Send confirmation back to backend
            if (message.requestId) {
                vscode.postMessage({
                    type: 'columnsUnfolded',
                    requestId: message.requestId
                });
            }
            break;
        case 'focusAfterUndoRedo':
            // Store focus targets to be processed after rendering completes
            window.pendingFocusTargets = message.focusTargets;
            break;
        case 'includeFileContent':
            // Handle include file content response from backend
            if (typeof window.updateIncludeFileCache === 'function') {
                window.updateIncludeFileCache(message.filePath, message.content);
            } else {
                console.warn('[webview.js]   ❌ window.updateIncludeFileCache is NOT a function! Cannot update cache.');
            }
            break;

        case 'updateIncludeContent':
            // Handle processed include content from backend
            if (typeof window.updateIncludeFileCache === 'function') {
                window.updateIncludeFileCache(message.filePath, message.content);
            } else {
                console.warn('[webview.js]   ❌ window.updateIncludeFileCache is NOT a function! Cannot update cache.');
            }
            break;

        case 'includesUpdated':
            // NOTE: Full re-render is no longer needed here.
            // updateIncludeFileCache now handles targeted re-rendering of only
            // the task descriptions containing pending include placeholders.
            // Keeping this case for backwards compatibility but not triggering renderBoard.
            break;
        case 'enableTaskIncludeMode':
            // Call the enableTaskIncludeMode function with the provided parameters
            if (typeof window.enableTaskIncludeMode === 'function') {
                window.enableTaskIncludeMode(message.taskId, message.columnId, message.fileName);
            }
            break;
        case 'clipboardImageSaved':
            // Handle clipboard image save response from backend
            if (message.success) {
                // Create a new task with the image filename as title and markdown link as description
                const imageFileName = message.relativePath.split('/').pop().replace(/\.[^/.]+$/, ''); // Remove extension
                const safePath = escapeFilePath(message.relativePath);
                const markdownLink = `![](${safePath})`;

                createTasksWithContent([{
                    title: imageFileName,
                    description: markdownLink
                }], message.dropPosition);
            } else {
                // Create error task if save failed
                createTasksWithContent([{
                    title: 'Clipboard Image (Error)',
                    description: `Failed to save image: ${message.error || 'Unknown error'}`
                }], message.dropPosition);
            }
            break;

        case 'diagramFileCreated':
            // Handle diagram file creation response from backend (Excalidraw/DrawIO)
            if (message.success) {
                // Create a new task with the diagram filename as title and markdown link as description
                const diagramFileName = message.fileName.replace(/\.[^/.]+$/, ''); // Remove extension
                const safeDiagramPath = escapeFilePath(message.relativePath);
                const diagramLink = `![](${safeDiagramPath})`;

                // Use explicit column and position from the message
                createTasksWithContent([{
                    title: diagramFileName,
                    description: diagramLink
                }], message.dropPosition, message.columnId, message.insertionIndex);
            } else {
                // Show error if diagram creation failed
                vscode.postMessage({
                    type: 'showMessage',
                    text: `Failed to create diagram: ${message.error || 'Unknown error'}`
                });
            }
            break;

        case 'clearDiagramCache':
            // Clear diagram render cache for specific files (or all if no paths specified)
            // Called when include files are modified externally (Excalidraw, DrawIO, etc.)
            if (typeof window.clearDiagramCache === 'function') {
                if (message.paths && message.paths.length > 0) {
                    // Clear cache for specific files
                    message.paths.forEach(filePath => {
                        if (typeof window.invalidateDiagramCache === 'function') {
                            // Clear for all diagram types (drawio, excalidraw)
                            window.invalidateDiagramCache(filePath, 'drawio');
                            window.invalidateDiagramCache(filePath, 'excalidraw');
                        }
                    });
                    console.log(`[Frontend] Cleared diagram cache for ${message.paths.length} file(s)`);
                } else {
                    // Clear entire cache
                    window.clearDiagramCache();
                    console.log('[Frontend] Cleared all diagram cache');
                }
            }
            break;

        case 'mediaFilesChanged':
            // Handle media files that have changed externally (detected via mtime comparison)
            // Only re-renders the specific files that changed, not everything
            // Backend sends "changedFiles", support both for compatibility
            const changedMediaFiles = message.changedFiles || message.files;
            if (changedMediaFiles && changedMediaFiles.length > 0) {
                console.log(`[Frontend] Media files changed:`, changedMediaFiles.map(f => f.path));

                // Process each changed file
                changedMediaFiles.forEach(file => {
                    console.log(`[Frontend] Processing changed file: ${file.path} (type: ${file.type})`);

                    if (file.type === 'diagram') {
                        // Clear diagram cache for this specific file
                        if (typeof window.invalidateDiagramCache === 'function') {
                            console.log(`[Frontend] Clearing diagram cache for: ${file.path}`);
                            window.invalidateDiagramCache(file.path, 'drawio');
                            window.invalidateDiagramCache(file.path, 'excalidraw');
                        }
                    }

                    // For images/diagrams, find and re-render all img elements with matching src
                    // Get just the filename for more reliable matching
                    const fileName = file.path.split('/').pop();

                    // Find all images referencing this file (match by filename, not full path)
                    // Don't use CSS.escape on paths as it over-escapes and breaks matching
                    const images = document.querySelectorAll('img');
                    const matchingImages = Array.from(images).filter(img => {
                        const src = img.getAttribute('src') || '';
                        return src.includes(fileName);
                    });
                    console.log(`[Frontend] Looking for images containing: ${fileName}`);
                    console.log(`[Frontend] Found ${matchingImages.length} matching images`);

                    matchingImages.forEach(img => {
                        // Force reload by appending cache-busting timestamp
                        const originalSrc = img.getAttribute('src');
                        if (originalSrc) {
                            // Remove any existing cache buster
                            const cleanSrc = originalSrc.replace(/[?&]_cb=\d+/, '');
                            // Add new cache buster
                            const separator = cleanSrc.includes('?') ? '&' : '?';
                            const newSrc = `${cleanSrc}${separator}_cb=${Date.now()}`;
                            console.log(`[Frontend] Updating img src: ${originalSrc} -> ${newSrc}`);
                            img.setAttribute('src', newSrc);
                        }
                    });

                    // For diagram files, find rendered diagram images and trigger re-render
                    if (file.type === 'diagram') {
                        // Diagrams are rendered as <img class="diagram-rendered" data-original-src="path">
                        // inside a container div with class "diagram-placeholder"
                        const allDiagramImages = document.querySelectorAll('img.diagram-rendered[data-original-src]');
                        const matchingImages = Array.from(allDiagramImages).filter(img => {
                            const originalSrc = img.getAttribute('data-original-src') || '';
                            return originalSrc.includes(fileName);
                        });
                        console.log(`[Frontend] Looking for diagram images with data-original-src containing: ${fileName}`);
                        console.log(`[Frontend] Found ${matchingImages.length} matching diagram images`);

                        matchingImages.forEach(img => {
                            const originalSrc = img.getAttribute('data-original-src');
                            if (!originalSrc) return;

                            // Determine diagram type from file extension
                            let diagramType = 'drawio';
                            if (originalSrc.endsWith('.excalidraw') ||
                                originalSrc.endsWith('.excalidraw.json') ||
                                originalSrc.endsWith('.excalidraw.svg')) {
                                diagramType = 'excalidraw';
                            }

                            console.log(`[Frontend] Re-rendering diagram: type=${diagramType}, path=${originalSrc}`);

                            // Get the parent container (diagram-placeholder div)
                            const container = img.parentElement;
                            if (container) {
                                // Show loading state and queue re-render
                                container.innerHTML = '<div class="diagram-loading">Reloading...</div>';

                                // Queue the diagram for re-rendering using the existing queue system
                                if (typeof window.queueDiagramRender === 'function') {
                                    const newId = `diagram-reload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                    container.id = newId;
                                    window.queueDiagramRender(newId, originalSrc, diagramType);
                                    // Trigger queue processing
                                    if (typeof window.processDiagramQueue === 'function') {
                                        window.processDiagramQueue();
                                    }
                                }
                            }
                        });
                    }
                });

                console.log(`[Frontend] Processed ${changedMediaFiles.length} changed media file(s)`);
            }
            break;

        case 'fileUriDropped':
            // Handle dropped file save/link response from backend
            if (message.success) {
                const originalName = message.originalFileName.replace(/\.[^/.]+$/, ''); // Remove extension
                const safePath = escapeFilePath(message.filePath);
                // Use image link syntax for diagram files (pdf, excalidraw, drawio)
                const isDiagramFile = /\.(pdf|excalidraw|excalidraw\.json|excalidraw\.svg|drawio|dio)$/i.test(message.originalFileName);
                const markdownLink = isDiagramFile
                    ? `![${message.originalFileName}](${safePath})`
                    : `[${message.originalFileName}](${safePath})`;

                createTasksWithContent([{
                    title: originalName,
                    description: markdownLink
                }], message.dropPosition);

                // Show notification
                if (message.wasCopied && window.activityManager) {
                    const operationId = `file-copy-${Date.now()}`;
                    window.activityManager.startOperation(
                        operationId,
                        'info',
                        `File copied to MEDIA folder`
                    );
                    window.activityManager.updateProgress(operationId, 100);
                } else if (message.wasLinked && window.activityManager) {
                    const operationId = `file-link-${Date.now()}`;
                    window.activityManager.startOperation(
                        operationId,
                        'info',
                        `File linked (already in workspace)`
                    );
                    window.activityManager.updateProgress(operationId, 100);
                }
            } else {
                console.error('[File-Drop] Failed to save file:', message.error);
                createTasksWithContent([{
                    title: message.originalFileName || 'File',
                    description: `Error: ${message.error}`
                }], message.dropPosition);
            }
            break;

        case 'fileContentsDropped':
            // Handle file saved from contents (File object drops)
            if (message.success) {
                const originalName = message.originalFileName.replace(/\.[^/.]+$/, ''); // Remove extension
                const safePath = escapeFilePath(message.filePath);
                // Use image link syntax for diagram files (pdf, excalidraw, drawio)
                const isDiagramFile = /\.(pdf|excalidraw|excalidraw\.json|excalidraw\.svg|drawio|dio)$/i.test(message.originalFileName);
                const markdownLink = isDiagramFile
                    ? `![${message.originalFileName}](${safePath})`
                    : `[${message.originalFileName}](${safePath})`;

                createTasksWithContent([{
                    title: originalName,
                    description: markdownLink
                }], message.dropPosition);

                // Show notification
                if (window.activityManager) {
                    const operationId = `file-save-${Date.now()}`;
                    window.activityManager.startOperation(
                        operationId,
                        'info',
                        `File saved to MEDIA folder`
                    );
                    window.activityManager.updateProgress(operationId, 100);
                }
            } else {
                console.error('[File-Drop] Failed to save file from contents:', message.error);
                createTasksWithContent([{
                    title: message.originalFileName || 'File',
                    description: `Error: ${message.error}`
                }], message.dropPosition);
            }
            break;

        case 'showFileDropDialogue':
            // Show dialogue for file drop options
            if (typeof window.showFileDropDialogue === 'function') {
                window.showFileDropDialogue(message);
            } else {
                console.error('[File-Drop] showFileDropDialogue function not available');
            }
            break;

        case 'droppedImageSaved':
            // Handle dropped image save response from backend
            if (message.success) {
                // Create task with original filename (without timestamp) as title
                const originalName = message.originalFileName.replace(/\.[^/.]+$/, ''); // Remove extension
                const safePath = escapeFilePath(message.relativePath);
                const markdownLink = `![](${safePath})`;

                createTasksWithContent([{
                    title: originalName,
                    description: markdownLink
                }], message.dropPosition);

                // Show notification based on what happened
                if (message.wasCopied && window.activityManager) {
                    // Image was copied from outside workspace
                    const operationId = `image-copy-${Date.now()}`;
                    window.activityManager.startOperation(
                        operationId,
                        'info',
                        `Image copied to MEDIA folder`
                    );
                    window.activityManager.updateProgress(operationId, 100);
                } else if (message.wasLinked && window.activityManager) {
                    // Image was already in workspace, just linked
                    const operationId = `image-link-${Date.now()}`;
                    window.activityManager.startOperation(
                        operationId,
                        'info',
                        `Image linked (already in workspace)`
                    );
                    window.activityManager.updateProgress(operationId, 100);
                }
                // If neither flag, it's from external drop (always copied, no notification needed)
            } else {
                console.error('[Image-Drop] Failed to save image:', message.error);
                // Create error task if save failed
                createTasksWithContent([{
                    title: 'Dropped Image (Error)',
                    description: `Failed to save image: ${message.error || 'Unknown error'}`
                }], message.dropPosition);
            }
            break;
        case 'insertSnippetContent':
            // Insert VS Code snippet content into the active editor
            insertVSCodeSnippetContent(message.content, message.fieldType, message.taskId);
            break;
        case 'replaceSelection':
            // Replace selected text with result from command (e.g., translation)
            if (window.taskEditorManager) {
                window.taskEditorManager.replaceSelection(message.text);
            }
            break;
        case 'proceedDisableIncludeMode':
            // User confirmed disable include mode in VS Code dialog - proceed with the action
            if (typeof disableColumnIncludeMode === 'function') {
                disableColumnIncludeMode(message.columnId);
            }
            break;
        case 'proceedEnableIncludeMode':
            // User provided file name in VS Code dialog - proceed with enabling include mode
            if (typeof enableColumnIncludeMode === 'function') {
                enableColumnIncludeMode(message.columnId, message.fileName);
            }
            break;
        case 'proceedUpdateIncludeFile':
            // User provided new file name in VS Code dialog - proceed with updating include file
            if (typeof updateColumnIncludeFile === 'function') {
                updateColumnIncludeFile(message.columnId, message.newFileName, message.currentFile);
            } else {
                console.error('[FRONTEND proceedUpdateIncludeFile] updateColumnIncludeFile function not found!');
            }
            break;
        case 'proceedUpdateTaskIncludeFile':
            // User provided new file name in VS Code dialog - proceed with updating task include file
            if (typeof updateTaskIncludeFile === 'function') {
                updateTaskIncludeFile(message.taskId, message.columnId, message.newFileName, message.currentFile);
            } else {
                console.error('[FRONTEND proceedUpdateTaskIncludeFile] updateTaskIncludeFile function not found!');
            }
            break;
        case 'revertColumnTitle':
            // Revert column title when user cancels include switch
            if (window.cachedBoard && window.cachedBoard.columns) {
                const columnToRevert = window.cachedBoard.columns.find(c => c.id === message.columnId);
                if (columnToRevert) {
                    columnToRevert.title = message.title;
                    // Clear any pending changes for this column
                    if (window.pendingColumnChanges && window.pendingColumnChanges.has(message.columnId)) {
                        window.pendingColumnChanges.delete(message.columnId);
                    }
                    // Re-render the column to show reverted title
                    if (typeof window.renderSingleColumn === 'function') {
                        window.renderSingleColumn(message.columnId, columnToRevert);
                    } else if (typeof window.renderBoard === 'function') {
                        window.renderBoard();
                    }
                }
            }
            break;
        case 'updateTemplates':
            // Update available templates list
            if (typeof window.updateTemplates === 'function') {
                window.updateTemplates(message.templates, message.showBar);
            }
            break;
        case 'templateVariables':
            // Show dialog to collect template variables
            showTemplateVariableDialog(message);
            break;
        case 'templateApplied':
            // Template was applied successfully
            // Use SAME approach as insertColumnAtPosition (via handleTemplateApplied in dragDrop.js):
            // 1. Render (columns at end)
            // 2. Move columns to correct DOM position
            // 3. syncColumnDataToDOMOrder()
            // 4. finalizeColumnDrop() which calls normalizeAllStackTags()
            if (message.board) {
                window.cachedBoard = message.board;
                if (typeof window.renderBoard === 'function') {
                    window.renderBoard();
                }

                // Use the SAME function from dragDrop.js that has access to syncColumnDataToDOMOrder and finalizeColumnDrop
                requestAnimationFrame(() => {
                    if (typeof window.handleTemplateApplied === 'function') {
                        window.handleTemplateApplied(message);
                    }
                });
            }
            break;
        case 'updateColumnContent':
            // Handle targeted column content update for include file changes
            if (window.cachedBoard && window.cachedBoard.columns) {
                const column = window.cachedBoard.columns.find(c => c.id === message.columnId);
                if (column) {
                    // Support both formats: individual properties OR column object
                    const colData = message.column || message;

                    // Update tasks and column metadata
                    if (colData.tasks !== undefined) column.tasks = colData.tasks;

                    // Update column title and displayTitle from backend
                    // Backend is source of truth after processing
                    if (colData.title !== undefined) column.title = colData.title;
                    // Also support legacy columnTitle property
                    if (message.columnTitle !== undefined) column.title = message.columnTitle;
                    if (colData.displayTitle !== undefined) column.displayTitle = colData.displayTitle;

                    // Clear any pending changes - backend has authoritative data
                    // This prevents stale pending changes from overriding backend updates
                    if (window.pendingColumnChanges && window.pendingColumnChanges.has(message.columnId)) {
                        window.pendingColumnChanges.delete(message.columnId);
                    }

                    // Only update includeMode if explicitly provided (preserve existing value otherwise)
                    if (colData.includeMode !== undefined) {
                        column.includeMode = colData.includeMode;
                    }
                    if (colData.includeFiles !== undefined) {
                        column.includeFiles = colData.includeFiles;
                    }
                    // Update loading state for includes
                    if (colData.isLoadingContent !== undefined) {
                        column.isLoadingContent = colData.isLoadingContent;
                    }

                    // Check if user is currently editing
                    const isEditing = window.taskEditor && window.taskEditor.currentEditor;

                    // CRITICAL: Always render when receiving include content or tasks
                    // Even if user is editing, new include content MUST be shown
                    const hasIncludeContent = message.includeMode || message.includeFiles;
                    const hasNewTasks = message.tasks && message.tasks.length > 0;
                    const forceRender = hasIncludeContent || hasNewTasks;

                    if (!isEditing || forceRender) {
                        // If forcing render while editing, save current editor state
                        if (isEditing && forceRender) {
                            // Save and close current editor to prevent conflicts
                            if (window.taskEditor && window.taskEditor.saveAndClose) {
                                window.taskEditor.saveAndClose();
                            }
                        }

                        // Re-render just this column
                        if (typeof window.renderSingleColumn === 'function') {
                            window.renderSingleColumn(message.columnId, column);
                        } else {
                            if (typeof window.renderBoard === 'function') {
                                window.renderBoard();
                            }
                        }

                        // Inject header/footer bars after rendering
                        if (typeof window.injectStackableBars === 'function') {
                            requestAnimationFrame(() => {
                                window.injectStackableBars();
                            });
                        }

                        // Recalculate stacked column heights after include content update
                        // Only update this column's stack for efficiency
                        if (typeof window.applyStackedColumnStyles === 'function') {
                            requestAnimationFrame(() => {
                                window.applyStackedColumnStyles(message.columnId);
                            });
                        }

                        // OPTIMIZATION 3: Confirm successful render
                        vscode.postMessage({
                            type: 'renderCompleted',
                            itemType: 'column',
                            itemId: message.columnId
                        });
                    } else {

                        // OPTIMIZATION 1: Tell backend this render was skipped
                        vscode.postMessage({
                            type: 'renderSkipped',
                            reason: 'editing',
                            itemType: 'column',
                            itemId: message.columnId
                        });
                    }
                }
            } else {
                console.warn('[Frontend] No cached board available for updateColumnContent');
            }
            break;
        case 'updateTaskContent':
            // Handle targeted task content update for include file changes

            // Update the task in cached board
            if (window.cachedBoard && window.cachedBoard.columns) {
                // Find the task across all columns
                let foundTask = null;
                let foundColumn = null;

                for (const column of window.cachedBoard.columns) {
                    const task = column.tasks.find(t => t.id === message.taskId);
                    if (task) {
                        foundTask = task;
                        foundColumn = column;
                        break;
                    }
                }

                if (foundTask && foundColumn) {
                    // Support both formats: individual properties OR task object
                    const taskData = message.task || message;

                    // Update task metadata
                    // CRITICAL FIX: Use !== undefined checks instead of || operator
                    // Empty string "" is falsy and would fall back to old value with ||
                    if (taskData.description !== undefined) foundTask.description = taskData.description;
                    if (taskData.title !== undefined) foundTask.title = taskData.title;
                    // Also support legacy taskTitle property
                    if (message.taskTitle !== undefined) foundTask.title = message.taskTitle;
                    if (taskData.displayTitle !== undefined) foundTask.displayTitle = taskData.displayTitle;
                    if (taskData.originalTitle !== undefined) foundTask.originalTitle = taskData.originalTitle;

                    // Only update includeMode if explicitly provided (preserve existing value otherwise)
                    if (taskData.includeMode !== undefined) {
                        foundTask.includeMode = taskData.includeMode;
                    }
                    if (taskData.includeFiles !== undefined) {
                        foundTask.includeFiles = taskData.includeFiles;
                    }
                    // Update loading state for includes
                    if (taskData.isLoadingContent !== undefined) {
                        foundTask.isLoadingContent = taskData.isLoadingContent;
                    }


                    // Check if user is currently editing - if so, handle carefully
                    const isEditing = window.taskEditor && window.taskEditor.currentEditor;
                    const isEditingThisTask = isEditing && window.taskEditor.currentEditor.taskId === message.taskId;

                    // CRITICAL FIX: For include changes, update the editor field value even if editing
                    // The backend has processed the include removal/addition and stopped editing
                    // We need to update the textarea to reflect the new title
                    if (isEditingThisTask && message.taskTitle !== undefined) {
                        const editor = window.taskEditor.currentEditor;
                        if (editor.type === 'task-title') {
                            // Update the editor field value to match the backend's processed title
                            editor.element.value = message.taskTitle || '';
                        }
                    }

                    if (!isEditing) {
                        // Re-render just this column to reflect the task update
                        if (typeof renderSingleColumn === 'function') {
                            renderSingleColumn(foundColumn.id, foundColumn);
                        } else {
                            if (typeof window.renderBoard === 'function') {
                                window.renderBoard();
                            }
                        }

                        // Inject header/footer bars after rendering
                        if (typeof window.injectStackableBars === 'function') {
                            requestAnimationFrame(() => {
                                window.injectStackableBars();
                            });
                        }

                        // Recalculate stacked column heights after task include content update (only this stack)
                        if (typeof window.applyStackedColumnStyles === 'function') {
                            requestAnimationFrame(() => {
                                window.applyStackedColumnStyles(foundColumn.id);
                            });
                        }

                        // OPTIMIZATION 3: Confirm successful render
                        vscode.postMessage({
                            type: 'renderCompleted',
                            itemType: 'task',
                            itemId: message.taskId
                        });
                    } else {

                        // OPTIMIZATION 1: Tell backend this render was skipped
                        vscode.postMessage({
                            type: 'renderSkipped',
                            reason: 'editing',
                            itemType: 'task',
                            itemId: message.taskId
                        });
                    }
                }
            }
            break;
        case 'syncDirtyItems':
            // OPTIMIZATION 2: Batch update multiple items with unrendered changes
            if (window.cachedBoard) {

                // Update columns
                for (const colData of message.columns) {
                    const column = window.cachedBoard.columns.find(c => c.id === colData.columnId);
                    if (column) {
                        // Update cache
                        column.title = colData.title;
                        column.displayTitle = colData.displayTitle;
                        column.includeMode = colData.includeMode;
                        column.includeFiles = colData.includeFiles;

                        // Update DOM directly (minimal update, no full re-render)
                        const titleEl = document.querySelector(`[data-column-id="${colData.columnId}"] .column-title-text`);
                        if (titleEl && window.tagUtils) {
                            titleEl.innerHTML = window.tagUtils.getColumnDisplayTitle(column, window.filterTagsFromText);
                        }
                    }
                }

                // Update tasks
                for (const taskData of message.tasks) {
                    const column = window.cachedBoard.columns.find(c => c.id === taskData.columnId);
                    if (column) {
                        const task = column.tasks.find(t => t.id === taskData.taskId);
                        if (task) {
                            // Update cache
                            task.displayTitle = taskData.displayTitle;
                            task.description = taskData.description;
                        }
                    }
                }

                // Re-render all dirty columns (after cache is updated)
                const renderedColumnIds = new Set();
                if (message.columns.length > 0) {
                    const columnIds = message.columns.map(col => col.columnId).filter(id => id);
                    if (columnIds.length > 0) {
                        window.renderBoard({ columns: columnIds });
                        // Track which columns were rendered (they include all their tasks)
                        columnIds.forEach(id => renderedColumnIds.add(id));
                    }
                }

                // Re-render dirty tasks that are NOT in columns we just rendered
                // (to avoid double-rendering the same column)
                if (message.tasks.length > 0) {
                    const taskUpdates = message.tasks
                        .filter(taskData => !renderedColumnIds.has(taskData.columnId))
                        .map(taskData => ({
                            columnId: taskData.columnId,
                            taskId: taskData.taskId
                        }))
                        .filter(t => t.columnId && t.taskId);
                    if (taskUpdates.length > 0) {
                        window.renderBoard({ tasks: taskUpdates });
                    }
                }
            }
            break;
        case 'stopEditing':
            // Backend requests to stop editing (e.g., due to external file conflict)
            let capturedEdit = null;

            if (window.taskEditor && window.taskEditor.currentEditor) {

                if (message.captureValue) {
                    // CAPTURE mode: Extract edit value WITHOUT modifying board
                    const editor = window.taskEditor.currentEditor;
                    capturedEdit = {
                        type: editor.type,
                        taskId: editor.taskId,
                        columnId: editor.columnId,
                        value: editor.element.value,
                        originalValue: editor.originalValue
                    };
                } else {
                    // SAVE mode: Normal save (for backwards compatibility)
                    if (typeof window.taskEditor.saveCurrentField === 'function') {
                        window.taskEditor.saveCurrentField();
                    }
                }

                // Clear editor state
                window.taskEditor.currentEditor = null;
            }

            // Send confirmation back to backend with captured value
            if (message.requestId) {
                vscode.postMessage({
                    type: 'editingStopped',
                    requestId: message.requestId,
                    capturedEdit: capturedEdit  // Include captured edit (null if not capturing)
                });
            }
            break;
        case 'exportDefaultFolder':
            setExportDefaultFolder(message.folderPath);
            break;
        case 'exportFolderSelected':
            setSelectedExportFolder(message.folderPath);
            break;
        case 'exportResult':
            handleExportResult(message.result);
            break;
        case 'marpStatus':
            handleMarpStatus(message);
            break;
        case 'marpThemesAvailable':

            // Clear the retry timeout
            if (window.marpThemesTimeout) {
                clearTimeout(window.marpThemesTimeout);
                window.marpThemesTimeout = null;
            }

            handleMarpThemesAvailable(message.themes, message.error);
            break;
        case 'marpAvailableClasses':
            handleMarpAvailableClasses(message.classes);
            break;
        case 'columnExportResult':
            handleColumnExportResult(message.result);
            break;
        case 'copyContentResult':
            handleCopyContentResult(message.result);
            break;

        // Activity indicator messages
        case 'operationStarted':
            if (window.activityManager) {
                window.activityManager.startOperation(
                    message.operationId,
                    message.operationType,
                    message.description
                );
            }
            break;

        case 'operationProgress':
            if (window.activityManager) {
                window.activityManager.updateProgress(
                    message.operationId,
                    message.progress,
                    message.message
                );
            }
            break;

        case 'operationCompleted':
            if (window.activityManager) {
                window.activityManager.endOperation(message.operationId);
            }
            break;

        case 'trackedFilesDebugInfo':
            // Handle debug info response from backend
            if (typeof window.updateTrackedFilesData === 'function') {
                window.updateTrackedFilesData(message.data);
            }
            break;

        case 'debugCacheCleared':
            // Handle debug cache clear confirmation
            break;

        case 'allIncludedFilesReloaded':
            // Handle reload confirmation (no UI notification needed)
            break;

        case 'individualFileSaved':
            // Handle individual file save confirmation
            const fileName = message.filePath.split('/').pop();
            if (message.success) {
                // Refresh the debug overlay to show updated states
                if (typeof window.refreshDebugOverlay === 'function') {
                    setTimeout(() => window.refreshDebugOverlay(), 500);
                }
            } else {
                console.error(`[Debug] Failed to save ${fileName}: ${message.error}`);
            }
            break;

        case 'individualFileReloaded':
            // Handle individual file reload confirmation
            const reloadedFileName = message.filePath.split('/').pop();
            if (message.success) {
                // Refresh the debug overlay to show updated states
                if (typeof window.refreshDebugOverlay === 'function') {
                    setTimeout(() => window.refreshDebugOverlay(), 500);
                }
            } else {
                console.error(`[Debug] Failed to reload ${reloadedFileName}: ${message.error}`);
            }
            break;

        case 'pathsConverted':
            // Handle single file path conversion result
            {
                const convertedFileName = message.filePath?.split('/').pop() || 'file';
                if (message.converted > 0) {
                    console.log(`[Paths] Converted ${message.converted} paths in ${convertedFileName}`);
                    // Refresh debug overlay to show updated state
                    if (typeof window.refreshDebugOverlay === 'function') {
                        setTimeout(() => window.refreshDebugOverlay(), 500);
                    }
                }
                if (message.warnings && message.warnings.length > 0) {
                    console.warn('[Paths] Conversion warnings:', message.warnings);
                }
            }
            break;

        case 'allPathsConverted':
            // Handle bulk path conversion result
            if (message.converted > 0) {
                console.log(`[Paths] Converted ${message.converted} paths in ${message.filesModified} file(s)`);
                // Refresh debug overlay to show updated state
                if (typeof window.refreshDebugOverlay === 'function') {
                    setTimeout(() => window.refreshDebugOverlay(), 500);
                }
            }
            if (message.warnings && message.warnings.length > 0) {
                console.warn('[Paths] Conversion warnings:', message.warnings);
            }
            break;

        case 'singlePathConverted':
            // Handle single path conversion result
            if (message.converted) {
                console.log(`[Paths] Converted: ${message.originalPath} -> ${message.newPath}`);

                // Update DOM elements that reference the old path
                updatePathInDOM(message.originalPath, message.newPath, message.direction);

                // Refresh debug overlay to show updated state
                if (typeof window.refreshDebugOverlay === 'function') {
                    setTimeout(() => window.refreshDebugOverlay(), 500);
                }
            } else {
                console.log(`[Paths] ${message.message}`);
            }
            break;

        case 'autoExportStopped':
            // Hide the auto-export button when auto-export is stopped
            const autoExportBtn = document.getElementById('auto-export-btn');
            if (autoExportBtn) {
                autoExportBtn.style.display = 'none';
                autoExportBtn.classList.remove('active');
            }
            // Reset auto-export state - both local and window variables
            autoExportActive = false;
            autoExportBrowserMode = false;
            lastExportSettings = null;
            window.autoExportActive = false;
            window.lastExportSettings = null;
            // Reset button text and icon to default state
            const icon = document.getElementById('auto-export-icon');
            if (icon) {
                icon.textContent = '▶';
            }
            // FORCE HIDE AGAIN after a short delay to ensure it's hidden
            setTimeout(() => {
                const btn = document.getElementById('auto-export-btn');
                if (btn) {
                    btn.style.display = 'none';
                    btn.classList.remove('active');
                }
            }, 100);
            break;

        case 'plantUMLConvertSuccess':
            // File will reload automatically, which will show the updated content
            break;

        case 'plantUMLConvertError':
            console.error('[PlantUML] Conversion error:', message.error);
            alert(`PlantUML conversion failed: ${message.error}`);
            break;

        // Mermaid export rendering (for PDF/Marp export)
        case 'renderMermaidForExport':

            // Use existing renderMermaid function to render the diagram
            renderMermaid(message.code)
                .then(svg => {

                    // Send success response back to backend
                    vscode.postMessage({
                        type: 'mermaidExportSuccess',
                        requestId: message.requestId,
                        svg: svg
                    });
                })
                .catch(error => {
                    console.error('[Webview] Mermaid render failed for export:', message.requestId, error);

                    // Send error response back to backend
                    vscode.postMessage({
                        type: 'mermaidExportError',
                        requestId: message.requestId,
                        error: error.message || String(error)
                    });
                });
            break;
    }
});
} // End of webviewEventListenersInitialized guard

/**
 * Insert VS Code snippet content into the active editor
 */
function insertVSCodeSnippetContent(content, fieldType, taskId) {
    // Use the current editor from taskEditor instead of searching for focused element
    // This fixes the timing issue where focus might be lost by the time the snippet arrives
    if (window.taskEditor && window.taskEditor.currentEditor) {
        const activeEditor = window.taskEditor.currentEditor.element;

        if (activeEditor) {
            // Insert the snippet content at cursor position
            const cursorPosition = activeEditor.selectionStart || 0;
            const textBefore = activeEditor.value.substring(0, cursorPosition);
            const textAfter = activeEditor.value.substring(activeEditor.selectionEnd || cursorPosition);

            // Insert the snippet
            activeEditor.value = textBefore + content + textAfter;

            // Position cursor after the snippet
            const newCursorPosition = cursorPosition + content.length;
            activeEditor.setSelectionRange(newCursorPosition, newCursorPosition);

            // Focus back to the editor
            activeEditor.focus();

            // Trigger input event to ensure the change is registered
            activeEditor.dispatchEvent(new Event('input', { bubbles: true }));

            // Auto-resize if needed
            if (typeof autoResize === 'function') {
                autoResize(activeEditor);
            }
        } else {
            console.warn('[Webview] currentEditor.element is null');
        }
    } else {
        console.warn('[Webview] Cannot insert snippet - no currentEditor:', {
            hasTaskEditor: !!window.taskEditor,
            hasCurrentEditor: !!(window.taskEditor && window.taskEditor.currentEditor)
        });
    }
}


// Watch for theme changes and update styles
if (typeof MutationObserver !== 'undefined') {
    const themeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                // Check if the body class actually changed (theme change)
                updateTagStylesForTheme();
            }
        });
    });

    // Start observing when DOM is ready
    if (document.body) {
        themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
    }
}


// Keyboard shortcuts for search and navigation (wrapped in guard)
if (!webviewEventListenersInitialized) {
document.addEventListener('keydown', (e) => {
    
    const activeElement = document.activeElement;
    const isEditing = activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.classList.contains('column-title-edit') ||
        activeElement.classList.contains('task-title-edit') ||
        activeElement.classList.contains('task-description-edit')
    );
    
    
    // Don't trigger search shortcuts when editing (except when in search input)
    const isInSearchInput = activeElement && activeElement.id === 'search-input';

    // Check if focused on a task section
    const isFocusedOnSection = activeElement && activeElement.classList.contains('task-section');
    const isFocusedOnTask = window.getCurrentFocusedCard() !== null;

    // Hierarchical arrow key navigation
    if (!isEditing && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();

        if (isFocusedOnSection) {
            // Navigation from section level
            window.handleSectionNavigation(e.key, activeElement);
        } else if (isFocusedOnTask) {
            // Navigation from task level
            window.handleTaskNavigation(e.key);
        } else {
            // Navigation from board level (no focus)
            const direction = {
                'ArrowUp': 'up',
                'ArrowDown': 'down',
                'ArrowLeft': 'left',
                'ArrowRight': 'right'
            }[e.key];
            window.navigateToCard(direction);
        }
        return;
    }

    // Escape to exit section focus and return to card focus
    if (e.key === 'Escape' && !isEditing && isFocusedOnSection) {
        const taskItem = activeElement.closest('.task-item');
        if (taskItem) {
            taskItem.focus();
        }
        return;
    }

    // Escape to clear card focus
    if (e.key === 'Escape' && !isEditing && window.getCurrentFocusedCard()) {
        window.focusCard(null);
        return;
    }
    
    // Ctrl+F or Cmd+F to open search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !isEditing) {
        e.preventDefault();
        kanbanSearch.openSearch();
        return;
    }
    
    // Handle search-specific shortcuts when search panel is open
    if (kanbanSearch && kanbanSearch.isSearching) {
        // Escape to close search
        if (e.key === 'Escape') {
            e.preventDefault();
            kanbanSearch.closeSearch();
            return;
        }
        
        // Enter for next result (when in search input)
        if (e.key === 'Enter' && isInSearchInput && !e.shiftKey) {
            e.preventDefault();
            kanbanSearch.nextResult();
            return;
        }
        
        // Shift+Enter for previous result (when in search input)
        if (e.key === 'Enter' && isInSearchInput && e.shiftKey) {
            e.preventDefault();
            kanbanSearch.previousResult();
            return;
        }
        
        // F3 for next result
        if (e.key === 'F3' && !e.shiftKey) {
            e.preventDefault();
            kanbanSearch.nextResult();
            return;
        }
        
        // Shift+F3 for previous result
        if (e.key === 'F3' && e.shiftKey) {
            e.preventDefault();
            kanbanSearch.previousResult();
            return;
        }
    }
    
    // Kanban-specific shortcuts (only when NOT editing)
    if (!isEditing && !isInSearchInput) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
        }
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            redo();
        }
        // Meta+S or Ctrl+S to save cached board to file
        else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (typeof saveCachedBoard === 'function') {
                saveCachedBoard();
            }
        }
        // Meta+W or Ctrl+W to close window - check for unsaved changes first
        else if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
            if (typeof hasUnsavedChanges === 'function' && hasUnsavedChanges()) {
                e.preventDefault();
                e.stopPropagation();
                
                // Show confirmation dialog using modalUtils
                const message = `You have unsaved changes. What would you like to do?`;

                modalUtils.showConfirmModal('Unsaved Changes', message, [
                    {
                        text: 'Cancel',
                        action: () => {
                            // Do nothing - just close modal
                        }
                    },
                    {
                        text: 'Discard & Close',
                        variant: 'danger',
                        action: () => {
                            // Clear unsaved changes flag - discard all changes
                            if (typeof markSavedChanges === 'function') {
                                markSavedChanges();
                            } else {
                                // Fallback if function not available
                                window.hasUnsavedChanges = false;
                                updateRefreshButtonState('default');
                                vscode.postMessage({
                                    type: 'markUnsavedChanges',
                                    hasUnsavedChanges: false
                                });
                            }

                            // Clear old pending changes (legacy cleanup)
                            if (window.pendingColumnChanges) {window.pendingColumnChanges.clear();}
                            if (window.pendingTaskChanges) {window.pendingTaskChanges.clear();}

                            // Let VS Code handle the close
                            vscode.postMessage({ type: 'closeWindow' });
                        }
                    },
                    {
                        text: 'Save & Close',
                        primary: true,
                        action: () => {
                            // Save changes first using new cache system
                            if (typeof saveCachedBoard === 'function') {
                                saveCachedBoard();
                            }

                            updateRefreshButtonState('saved');
                            // Let VS Code handle the close
                            vscode.postMessage({ type: 'closeWindow' });
                        }
                    }
                ]);
                
                // Also close on escape key
                const escapeHandler = (e) => {
                    if (e.key === 'Escape') {
                        modal.remove();
                        document.removeEventListener('keydown', escapeHandler);
                    }
                };
                document.addEventListener('keydown', escapeHandler);
            }
        }
        // Delete or Backspace to delete the focused task
        else if ((e.key === 'Delete' || e.key === 'Backspace') && window.getCurrentFocusedCard()) {
            e.preventDefault();
            const focusedCard = window.getCurrentFocusedCard();
            const taskId = focusedCard.dataset.taskId;
            const columnId = window.getColumnIdFromElement(focusedCard);
            if (taskId && typeof deleteTask === 'function') {
                deleteTask(taskId, columnId);
                window.focusCard(null);
            }
        }
        // Enter to start editing the focused task
        else if (e.key === 'Enter' && window.getCurrentFocusedCard()) {
            e.preventDefault();
            const focusedCard = window.getCurrentFocusedCard();
            const taskId = focusedCard.dataset.taskId;
            const columnId = window.getColumnIdFromElement(focusedCard);
            // Start editing the title section
            if (window.taskEditor && taskId) {
                window.taskEditor.startEdit(focusedCard, 'task-title', taskId, columnId, false);
            }
        }
    }
});

// Undo/Redo functions
/**
 * Triggers undo operation
 * Purpose: Revert last change
 * Used by: Undo button, Cmd/Ctrl+Z
 * Side effects: Sends undo message to VS Code
 */
function undo() {
    if (canUndo) {
        try {
            vscode.postMessage({ type: 'undo' });
        } catch (error) {
            // Silently handle error
        }
    }
}

/**
 * Triggers redo operation
 * Purpose: Reapply undone change
 * Used by: Redo button, Cmd/Ctrl+Shift+Z
 * Side effects: Sends redo message to VS Code
 */
function redo() {
    if (canRedo) {
        vscode.postMessage({ type: 'redo' });
    }
}

// COMPREHENSIVE CLOSE DETECTION - Prevent data loss
// Add beforeunload detection for unsaved changes
window.addEventListener('beforeunload', function(e) {
    if (typeof hasUnsavedChanges === 'function') {
        if (hasUnsavedChanges()) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return 'You have unsaved changes. Are you sure you want to leave?';
        }
    } else {
        console.error('❌ hasUnsavedChanges function not available');
    }
});

// Note: unload event removed - was empty/no-op

// Add visibility change detection (tab switching, window minimizing, etc)
// Global flag to prevent auto-save when close prompt is active
let closePromptActive = false;

document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        
        // Always notify backend about page becoming hidden
        // Backend will check its own unsaved changes state and handle accordingly
        
        // Set flag to prevent auto-save while close prompt might be active
        closePromptActive = true;
        
        // Let backend decide what to do based on its own unsaved changes state
        setTimeout(() => {
            vscode.postMessage({
                type: 'pageHiddenWithUnsavedChanges',
                hasUnsavedChanges: true // Backend will use its own state, not this value
            });
        }, 0);
    } else {
        // Reset flag when page becomes visible again
        closePromptActive = false;
    }
});
} // End of second webviewEventListenersInitialized guard

function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (undoBtn) {
        undoBtn.disabled = !canUndo;
        undoBtn.style.opacity = canUndo ? '1' : '0.5';
    }
    
    if (redoBtn) {
        redoBtn.disabled = !canRedo;
        redoBtn.style.opacity = canRedo ? '1' : '0.5';
    }
}

function insertFileLink(fileInfo) {
    
    const { fileName, relativePath, isImage } = fileInfo;
    let activeEditor = getActiveTextEditor();
    

    // Create markdown link using unified function
    const markdownLink = createFileMarkdownLink(relativePath);
    
    if (activeEditor && activeEditor.element && 
        document.contains(activeEditor.element) && 
        activeEditor.element.style.display !== 'none') {
        
        // Insert at current cursor position
        const element = activeEditor.element;
        const cursorPos = element.selectionStart || activeEditor.cursorPosition || 0;
        const currentValue = element.value;
        
        const newValue = currentValue.slice(0, cursorPos) + markdownLink + currentValue.slice(cursorPos);
        element.value = newValue;
        
        // Update cursor position
        const newCursorPos = cursorPos + markdownLink.length;
        element.setSelectionRange(newCursorPos, newCursorPos);
        
        // Trigger input event to auto-resize if needed
        element.dispatchEvent(new Event('input'));
        if (typeof autoResize === 'function') {
            autoResize(element);
        }
        
        // FOR IMAGES: Also add to the other field if needed
        if (isImage && (activeEditor.type === 'task-title' || activeEditor.type === 'task-description')) {
            const taskItem = element.closest('.task-item');
            const otherField = activeEditor.type === 'task-title' ? 
                taskItem.querySelector('.task-description-edit') : 
                taskItem.querySelector('.task-title-edit');
            
            if (otherField) {
                const otherValue = otherField.value;
                otherField.value = otherValue ? `${otherValue}\n${markdownLink}` : markdownLink;
                otherField.dispatchEvent(new Event('input'));
                if (typeof autoResize === 'function') {
                    autoResize(otherField);
                }
            }
        }
        
        // Focus back on the element
        element.focus();
        
        // Save the changes immediately
        setTimeout(() => {
            if (element.classList.contains('task-title-edit') || element.classList.contains('task-description-edit')) {
                if (taskEditor.currentEditor && taskEditor.currentEditor.element === element) {
                    taskEditor.save();
                }
            } else if (element.classList.contains('column-title-edit')) {
                element.blur();
            }
        }, 50);
        
        vscode.postMessage({ type: 'showMessage', text: `Inserted ${isImage ? 'image' : 'file'} link: ${fileName}` });
    } else {
        // Create new task with the file link
        createTasksWithContent([{
            title: markdownLink,
            description: isImage ? markdownLink : ''
        }], fileInfo.dropPosition);
        vscode.postMessage({ type: 'showMessage', text: `Created new task with ${isImage ? 'image' : 'file'} link: ${fileName}` });
    }
}

/**
 * Updates the file info bar with current document details
 * Purpose: Show current file name and path
 * Used by: Document changes, initialization
 * Side effects: Updates DOM elements with file info
 */
function updateFileInfoBar() {
    if (!currentFileInfo) {return;}

    const fileNameElement = document.getElementById('file-name');

    if (fileNameElement) {
        fileNameElement.textContent = currentFileInfo.fileName;
        fileNameElement.title = `Click to open: ${currentFileInfo.filePath || currentFileInfo.fileName}`;
        fileNameElement.style.cursor = 'pointer';

        // Remove any existing click handler to avoid duplicates
        fileNameElement.onclick = null;

        // Add click handler to open the file
        fileNameElement.onclick = () => {
            if (currentFileInfo.filePath) {
                vscode.postMessage({
                    type: 'openFileLink',
                    href: currentFileInfo.filePath
                });
            }
        };
    }

    // Update undo/redo buttons when file info changes
    updateUndoRedoButtons();
}

function selectFile() {
    // Save current state before potentially switching files
    saveCurrentFoldingState();
    vscode.postMessage({ type: 'selectFile' });
}

/**
 * Convert paths in main file to relative format
 */
function convertPathsToRelative() {
    vscode.postMessage({ type: 'convertPaths', direction: 'relative', isMainFile: true });
}

/**
 * Convert paths in main file to absolute format
 */
function convertPathsToAbsolute() {
    vscode.postMessage({ type: 'convertPaths', direction: 'absolute', isMainFile: true });
}

/**
 * Toggle the image path menu visibility
 * Called from inline onclick handlers in rendered markdown
 * Creates menu dynamically and appends to body to avoid stacking context issues
 */
function toggleImagePathMenu(container, imagePath) {
    // Close any existing floating menus
    const existingMenu = document.getElementById('floating-image-path-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    // Close any other open menus (both image and include)
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible, .image-not-found-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });

    // Get button position for menu placement
    const button = container.querySelector('.image-menu-btn');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const isAbsolutePath = imagePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(imagePath);
    const escapedPath = imagePath.replace(/'/g, "\\'").replace(/"/g, '\\"');

    // Check if the image is broken (has the image-broken class)
    const isBroken = container.classList.contains('image-broken');

    // Create floating menu
    const menu = document.createElement('div');
    menu.id = 'floating-image-path-menu';
    menu.className = 'image-path-menu visible';
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 2) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '999999';
    menu.dataset.imagePath = imagePath;

    if (isBroken) {
        // Menu for broken images - Open disabled, Search/Browse enabled
        menu.innerHTML = `
            <button class="image-path-menu-item disabled" disabled>📄 Open</button>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); searchForFile('${escapedPath}')">🔎 Search for File</button>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); browseForImage('${escapedPath}')">📂 Browse for File</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" ${isAbsolutePath ? `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'relative', true)"` : 'disabled'}>📁 Convert to Relative</button>
            <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" ${isAbsolutePath ? 'disabled' : `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'absolute', true)"`}>📂 Convert to Absolute</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); deleteFromMarkdown('${escapedPath}')">🗑️ Delete</button>
        `;
    } else {
        // Menu for valid images - Open enabled, Search/Browse disabled
        menu.innerHTML = `
            <button class="image-path-menu-item" onclick="event.stopPropagation(); openPath('${escapedPath}')">📄 Open</button>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
            <button class="image-path-menu-item disabled" disabled>🔎 Search for File</button>
            <button class="image-path-menu-item disabled" disabled>📂 Browse for File</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" ${isAbsolutePath ? `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'relative', true)"` : 'disabled'}>📁 Convert to Relative</button>
            <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" ${isAbsolutePath ? 'disabled' : `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'absolute', true)"`}>📂 Convert to Absolute</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); deleteFromMarkdown('${escapedPath}')">🗑️ Delete</button>
        `;
    }

    document.body.appendChild(menu);

    // Adjust position if menu goes off screen
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - menuRect.width - 10) + 'px';
    }
    if (menuRect.bottom > window.innerHeight) {
        menu.style.top = (rect.top - menuRect.height - 2) + 'px';
    }

    // Close menu when clicking outside
    const closeHandler = (e) => {
        if (!menu.contains(e.target) && !container.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

/**
 * Toggle the include path menu visibility
 * Called from inline onclick handlers in rendered include links
 */
function toggleIncludePathMenu(container, includePath) {
    // Close any other open menus (both image and include)
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible').forEach(menu => {
        if (menu.parentElement !== container) {
            menu.classList.remove('visible');
        }
    });

    const menu = container.querySelector('.include-path-menu');
    if (menu) {
        menu.classList.toggle('visible');

        // Close menu when clicking outside
        if (menu.classList.contains('visible')) {
            const closeHandler = (e) => {
                if (!container.contains(e.target)) {
                    menu.classList.remove('visible');
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    }
}

/**
 * Convert a single path (image or include)
 * Called from inline onclick handlers in rendered markdown
 */
function convertSinglePath(imagePath, direction, skipRefresh = false) {
    console.log(`[convertSinglePath] Called with path: "${imagePath}", direction: ${direction}, skipRefresh: ${skipRefresh}`);

    // Close all menus (both image and include)
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible, .image-not-found-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });

    vscode.postMessage({
        type: 'convertSinglePath',
        imagePath: imagePath,
        direction: direction,
        skipRefresh: skipRefresh
    });
}

/**
 * Open a file path directly (in VS Code or default app)
 * Called from inline onclick handlers in rendered markdown
 */
function openPath(filePath) {
    console.log(`[openPath] Called with path: "${filePath}"`);

    // Close all menus (both image and include)
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });

    vscode.postMessage({
        type: 'openPath',
        filePath: filePath
    });
}

/**
 * Reveal a file path in the system file explorer (Finder on macOS, Explorer on Windows)
 * Called from inline onclick handlers in rendered markdown
 */
function revealPathInExplorer(filePath) {
    console.log(`[revealPathInExplorer] Called with path: "${filePath}"`);

    // Close all menus (both image and include)
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });

    vscode.postMessage({
        type: 'revealPathInExplorer',
        filePath: filePath
    });
}

/**
 * Handle image not found - replace broken image with a placeholder that has a burger menu
 * Called from image onerror handlers
 * Uses data attributes instead of inline onclick to safely handle paths with special characters
 */
function handleImageNotFound(imgElement, originalSrc) {
    console.log(`[handleImageNotFound] Called with path: "${originalSrc}"`);

    if (!imgElement || !imgElement.parentElement) {
        console.warn('[handleImageNotFound] No imgElement or parent');
        return;
    }

    // Check if already handled (prevent double processing)
    if (imgElement.dataset.handled === 'true') {
        console.log('[handleImageNotFound] Already handled, skipping');
        return;
    }
    imgElement.dataset.handled = 'true';

    // Check if the image is inside an existing image-path-overlay-container
    // If so, we need to upgrade the existing container, not create a nested one
    const existingOverlay = imgElement.closest('.image-path-overlay-container');
    if (existingOverlay) {
        console.log('[handleImageNotFound] Image is inside overlay container, upgrading existing menu');

        // Create a simple placeholder span for the image
        const placeholder = document.createElement('span');
        placeholder.className = 'image-not-found';
        placeholder.dataset.originalSrc = originalSrc;
        placeholder.title = `Image not found: ${originalSrc}`;
        placeholder.innerHTML = `<span class="image-not-found-text">📷 Image not found</span>`;

        // Insert placeholder before the image and hide the image
        imgElement.parentElement.insertBefore(placeholder, imgElement);
        imgElement.style.display = 'none';

        // Upgrade the existing overlay container
        upgradeImageOverlayToBroken(existingOverlay, placeholder, originalSrc);
        return;
    }

    // Standalone image - create full container with menu
    console.log('[handleImageNotFound] Standalone image, creating full container');

    const htmlEscapedPath = originalSrc.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isAbsolutePath = originalSrc.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(originalSrc);

    // Create container with burger menu
    const container = document.createElement('div');
    container.className = 'image-not-found-container';
    container.dataset.imagePath = originalSrc;

    container.innerHTML = `
        <span class="image-not-found" data-original-src="${htmlEscapedPath}" title="Image not found: ${htmlEscapedPath}">
            <span class="image-not-found-text">📷 Image not found</span>
            <button class="image-menu-btn" data-action="toggle-menu" title="Path options">☰</button>
        </span>
        <div class="image-not-found-menu" data-is-absolute="${isAbsolutePath}">
            <button class="image-path-menu-item disabled" disabled>📄 Open</button>
            <button class="image-path-menu-item" data-action="reveal">🔍 Reveal in File Explorer</button>
            <button class="image-path-menu-item" data-action="search">🔎 Search for File</button>
            <button class="image-path-menu-item" data-action="browse">📂 Browse for File</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" data-action="to-relative" ${isAbsolutePath ? '' : 'disabled'}>📁 Convert to Relative</button>
            <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" data-action="to-absolute" ${isAbsolutePath ? 'disabled' : ''}>📂 Convert to Absolute</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item" data-action="delete">🗑️ Delete</button>
        </div>
    `;

    imgElement.parentElement.insertBefore(container, imgElement);
    imgElement.style.display = 'none';
}
// Expose to window for inline onerror handler
window.handleImageNotFound = handleImageNotFound;

/**
 * Toggle the image-not-found menu visibility
 */
function toggleImageNotFoundMenu(container) {
    // Close any other open menus
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible, .image-not-found-menu.visible').forEach(menu => {
        if (menu.parentElement !== container) {
            menu.classList.remove('visible');
        }
    });

    const menu = container.querySelector('.image-not-found-menu');
    if (menu) {
        menu.classList.toggle('visible');

        // Close menu when clicking outside
        if (menu.classList.contains('visible')) {
            const closeHandler = (e) => {
                if (!container.contains(e.target)) {
                    menu.classList.remove('visible');
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    }
}

/**
 * Search for a file by name
 */
function searchForFile(filePath) {
    console.log(`[searchForFile] Called with path: "${filePath}"`);

    // Close all menus
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible, .image-not-found-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });

    vscode.postMessage({
        type: 'searchForFile',
        filePath: filePath
    });
}

/**
 * Browse for an image file to replace a broken image path
 * Opens a file dialog and replaces the old path with the selected file
 */
function browseForImage(oldPath) {
    console.log(`[browseForImage] Called with oldPath: "${oldPath}"`);

    // Close all menus
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible, .image-not-found-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });

    vscode.postMessage({
        type: 'browseForImage',
        oldPath: oldPath
    });
}

/**
 * Delete an element from the markdown source
 * This will remove the entire markdown element (image, link, include, etc.) from the document
 */
function deleteFromMarkdown(path) {
    console.log(`[deleteFromMarkdown] Called with path: "${path}"`);

    // Close all menus
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible, .image-not-found-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });

    vscode.postMessage({
        type: 'deleteFromMarkdown',
        path: path
    });
}

// Event delegation for image-not-found menu actions
// This is more robust than inline onclick handlers for paths with special characters
if (!webviewEventListenersInitialized) {
    document.addEventListener('click', (e) => {
        const target = e.target;
        const action = target.dataset?.action;

        // Debug: Log all clicks on menu items
        if (target.classList?.contains('image-path-menu-item')) {
            console.log('[EventDelegation] Click on menu item:', {
                target: target,
                action: action,
                text: target.textContent,
                disabled: target.disabled,
                classList: Array.from(target.classList)
            });
        }

        if (!action) return;

        console.log('[EventDelegation] Action detected:', action);

        // Find the container to get the image path
        // Check both container types: standalone broken images and broken images in overlay
        const container = target.closest('.image-not-found-container') || target.closest('.image-path-overlay-container');
        console.log('[EventDelegation] Container found:', container);

        if (!container) {
            console.log('[EventDelegation] No container found, returning');
            return;
        }

        const imagePath = container.dataset.imagePath;
        console.log('[EventDelegation] imagePath:', imagePath);

        if (!imagePath && action !== 'toggle-menu') {
            console.log('[EventDelegation] No imagePath and action is not toggle-menu, returning');
            return;
        }

        e.stopPropagation();

        switch (action) {
            case 'toggle-menu':
                console.log('[EventDelegation] Toggling menu');
                toggleImageNotFoundMenu(container);
                break;
            case 'reveal':
                console.log('[EventDelegation] Revealing path');
                revealPathInExplorer(imagePath);
                break;
            case 'search':
            case 'search-overlay':
                console.log('[EventDelegation] Searching for replacement:', imagePath);
                // Close the menu first
                const searchMenu = container.querySelector('.image-path-menu.visible, .image-not-found-menu.visible');
                if (searchMenu) searchMenu.classList.remove('visible');
                searchForFile(imagePath);
                break;
            case 'browse':
            case 'browse-overlay':
                console.log('[EventDelegation] Browsing for replacement:', imagePath);
                // Close the menu first
                const browseMenu = container.querySelector('.image-path-menu.visible, .image-not-found-menu.visible');
                if (browseMenu) browseMenu.classList.remove('visible');
                browseForImage(imagePath);
                break;
            case 'to-relative':
                if (!target.disabled) {
                    console.log('[EventDelegation] Converting to relative');
                    convertSinglePath(imagePath, 'relative', true);
                }
                break;
            case 'to-absolute':
                if (!target.disabled) {
                    console.log('[EventDelegation] Converting to absolute');
                    convertSinglePath(imagePath, 'absolute', true);
                }
                break;
            case 'delete':
                console.log('[EventDelegation] Deleting element:', imagePath);
                // Close the menu first
                const deleteMenu = container.querySelector('.image-path-menu.visible, .image-not-found-menu.visible');
                if (deleteMenu) deleteMenu.classList.remove('visible');
                deleteFromMarkdown(imagePath);
                break;
        }
    });
}

// Expose functions to window for compatibility
window.toggleImageNotFoundMenu = toggleImageNotFoundMenu;
window.searchForFile = searchForFile;

/**
 * Upgrade a simple image-not-found placeholder to a full container with menu
 * Simple placeholders are created by the onerror fallback when handleImageNotFound isn't available
 * They only have: <span class="image-not-found" data-original-src="..."></span>
 * This function upgrades them to the full container with burger menu and all options
 */
function upgradeSimpleImageNotFoundPlaceholder(simpleSpan) {
    // Skip if already upgraded (has parent container)
    if (simpleSpan.closest('.image-not-found-container')) {
        return false;
    }

    // Skip if it's already a full placeholder (has the text child)
    if (simpleSpan.querySelector('.image-not-found-text')) {
        return false;
    }

    // Get the original path from data attribute
    const originalSrc = simpleSpan.dataset.originalSrc || simpleSpan.getAttribute('data-original-src');
    if (!originalSrc) {
        return false;
    }

    // Check if this placeholder is inside an existing image-path-overlay-container
    // This happens when a valid image's onerror fires - the container already has a menu
    const existingOverlay = simpleSpan.closest('.image-path-overlay-container');
    if (existingOverlay) {
        return upgradeImageOverlayToBroken(existingOverlay, simpleSpan, originalSrc);
    }

    // Standalone placeholder - create full container
    const htmlEscapedPath = originalSrc.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isAbsolutePath = originalSrc.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(originalSrc);

    // Create the full container
    const container = document.createElement('div');
    container.className = 'image-not-found-container';
    container.dataset.imagePath = originalSrc;

    container.innerHTML = `
        <span class="image-not-found" data-original-src="${htmlEscapedPath}" title="Image not found: ${htmlEscapedPath}">
            <span class="image-not-found-text">📷 Image not found</span>
            <button class="image-menu-btn" data-action="toggle-menu" title="Path options">☰</button>
        </span>
        <div class="image-not-found-menu" data-is-absolute="${isAbsolutePath}">
            <button class="image-path-menu-item disabled" disabled>📄 Open</button>
            <button class="image-path-menu-item" data-action="reveal">🔍 Reveal in File Explorer</button>
            <button class="image-path-menu-item" data-action="search">🔎 Search for File</button>
            <button class="image-path-menu-item" data-action="browse">📂 Browse for File</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" data-action="to-relative" ${isAbsolutePath ? '' : 'disabled'}>📁 Convert to Relative</button>
            <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" data-action="to-absolute" ${isAbsolutePath ? 'disabled' : ''}>📂 Convert to Absolute</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item" data-action="delete">🗑️ Delete</button>
        </div>
    `;

    // Replace the simple span with the full container
    simpleSpan.parentElement.insertBefore(container, simpleSpan);
    simpleSpan.remove();

    return true;
}

/**
 * Upgrade an existing image-path-overlay-container to handle a broken image
 * The container already has a menu, we just need to:
 * 1. Add text to the placeholder span
 * 2. Enable "Search for File" in the existing menu
 * 3. Disable "Open" in the existing menu
 * 4. Store the path for event delegation
 */
function upgradeImageOverlayToBroken(overlayContainer, simpleSpan, originalSrc) {
    // Add the "Image not found" text to the simple span
    simpleSpan.innerHTML = `<span class="image-not-found-text">📷 Image not found</span>`;
    simpleSpan.title = `Image not found: ${originalSrc}`;

    // Store the path on the overlay container for event delegation
    overlayContainer.dataset.imagePath = originalSrc;
    overlayContainer.classList.add('image-broken');

    // Find and update the existing menu
    const existingMenu = overlayContainer.querySelector('.image-path-menu');

    if (existingMenu) {
        // Find the "Open" button and disable it
        const openBtn = existingMenu.querySelector('.image-path-menu-item');
        if (openBtn && openBtn.textContent.includes('Open')) {
            openBtn.classList.add('disabled');
            openBtn.disabled = true;
            openBtn.removeAttribute('onclick');
        }

        // Find the "Search for File" button and enable it
        const searchBtn = Array.from(existingMenu.querySelectorAll('.image-path-menu-item')).find(
            btn => btn.textContent.includes('Search')
        );
        if (searchBtn) {
            searchBtn.classList.remove('disabled');
            searchBtn.disabled = false;
            // Use onclick closure - captures path safely, no escaping issues
            searchBtn.onclick = function(e) {
                e.stopPropagation();
                searchForFile(originalSrc);
            };
        }

        // Find the "Browse for File" button and enable it
        const browseBtn = Array.from(existingMenu.querySelectorAll('.image-path-menu-item')).find(
            btn => btn.textContent.includes('Browse')
        );
        if (browseBtn) {
            browseBtn.classList.remove('disabled');
            browseBtn.disabled = false;
            // Use onclick closure - captures path safely, no escaping issues
            browseBtn.onclick = function(e) {
                e.stopPropagation();
                browseForImage(originalSrc);
            };
        }
    }

    return true;
}

/**
 * Upgrade all simple image-not-found placeholders in the document
 * Call this after markdown rendering to ensure all placeholders have the full menu
 */
function upgradeAllSimpleImageNotFoundPlaceholders() {
    const simplePlaceholders = document.querySelectorAll('.image-not-found:not(.image-not-found-container .image-not-found)');
    let upgradedCount = 0;

    simplePlaceholders.forEach(span => {
        if (upgradeSimpleImageNotFoundPlaceholder(span)) {
            upgradedCount++;
        }
    });

    if (upgradedCount > 0) {
        console.log(`[upgradeAllSimpleImageNotFoundPlaceholders] Upgraded ${upgradedCount} placeholder(s)`);
    }
}

// Expose upgrade function globally so it can be called after markdown rendering
window.upgradeAllSimpleImageNotFoundPlaceholders = upgradeAllSimpleImageNotFoundPlaceholders;

// MutationObserver to automatically upgrade simple placeholders when they're added to the DOM
// This handles cases where images fail to load after the initial render
if (!webviewEventListenersInitialized) {
    const setupImageNotFoundObserver = () => {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', setupImageNotFoundObserver);
            return;
        }

        const imageNotFoundObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if the added node is a simple placeholder
                            const isImageNotFound = node.classList?.contains('image-not-found');
                            const hasContainer = node.closest('.image-not-found-container');

                            if (isImageNotFound && !hasContainer) {
                                upgradeSimpleImageNotFoundPlaceholder(node);
                            }

                            // Also check for simple placeholders within the added node
                            const simplePlaceholders = node.querySelectorAll?.('.image-not-found:not(.image-not-found-container .image-not-found)');
                            if (simplePlaceholders?.length > 0) {
                                simplePlaceholders.forEach(span => upgradeSimpleImageNotFoundPlaceholder(span));
                            }
                        }
                    });
                }
            }
        });

        // Start observing the document body for added nodes
        imageNotFoundObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Also run upgrade on any existing simple placeholders
        upgradeAllSimpleImageNotFoundPlaceholders();
    };

    // Try to set up immediately, or wait for DOMContentLoaded
    setupImageNotFoundObserver();
}

/**
 * Update path references in the DOM and cached board after a path conversion
 * This allows updating the UI without a full board refresh
 */
function updatePathInDOM(oldPath, newPath, direction) {
    console.log(`[updatePathInDOM] Updating path from "${oldPath}" to "${newPath}"`);

    // Update the cached board data (used for editing)
    if (window.cachedBoard) {
        let boardUpdated = false;

        // Update paths in all columns and tasks
        window.cachedBoard.columns.forEach(column => {
            // Update column description/markdown
            if (column.markdown && column.markdown.includes(oldPath)) {
                column.markdown = column.markdown.split(oldPath).join(newPath);
                boardUpdated = true;
            }
            if (column.description && column.description.includes(oldPath)) {
                column.description = column.description.split(oldPath).join(newPath);
                boardUpdated = true;
            }

            // Update tasks
            if (column.tasks) {
                column.tasks.forEach(task => {
                    if (task.markdown && task.markdown.includes(oldPath)) {
                        task.markdown = task.markdown.split(oldPath).join(newPath);
                        boardUpdated = true;
                    }
                    if (task.description && task.description.includes(oldPath)) {
                        task.description = task.description.split(oldPath).join(newPath);
                        boardUpdated = true;
                    }
                    if (task.content && task.content.includes(oldPath)) {
                        task.content = task.content.split(oldPath).join(newPath);
                        boardUpdated = true;
                    }
                });
            }
        });

        if (boardUpdated) {
            console.log(`[updatePathInDOM] Updated cached board data`);
            // Mark as having unsaved changes
            window.hasUnsavedChanges = true;
        }
    }

    console.log(`[updatePathInDOM] Path updated in cached board`);
}

function updateWhitespace(value) {
    // Ensure we have a valid value with 'px' suffix
    if (!value) {
        value = '4px';
    }
    // If the value is just a number, add 'px'
    if (!isNaN(value)) {
        value = value + 'px';
    }

    document.documentElement.style.setProperty('--whitespace', value);
}

function updateBorderStyles() {
    // Borders should be set via window.borderConfig from extension
    if (!window.borderConfig) {
        // Configuration will be received shortly after webview loads
        return;
    }

    const { columnBorder, taskBorder } = window.borderConfig;

    // Apply CSS variables
    document.documentElement.style.setProperty('--column-border', columnBorder);
    document.documentElement.style.setProperty('--task-border', taskBorder);
}

function calculateTaskDescriptionHeight() {
    // Only calculate if we're in height-limited mode
    if (!document.body.classList.contains('task-height-limited')) {
        return;
    }

    const taskHeight = getComputedStyle(document.documentElement).getPropertyValue('--task-height');
    if (!taskHeight || taskHeight === 'auto') {
        return;
    }

    // Get all task items
    document.querySelectorAll('.task-item').forEach(taskItem => {
        const descContainer = taskItem.querySelector('.task-description-container');
        if (!descContainer) {return;}

        // Calculate the total height of other elements in the task-item
        let usedHeight = 0;

        // Add header bars height if present
        const headerBars = taskItem.querySelector('.header-bars-container');
        if (headerBars) {
            usedHeight += headerBars.offsetHeight;
        }

        // Add task header height
        const taskHeader = taskItem.querySelector('.task-header');
        if (taskHeader) {
            usedHeight += taskHeader.offsetHeight;
        }

        // Add footer bars height if present
        const footerBars = taskItem.querySelector('.footer-bars-container');
        if (footerBars) {
            usedHeight += footerBars.offsetHeight;
        }

        // Get the task item's computed styles
        const taskItemStyles = getComputedStyle(taskItem);
        const paddingTop = parseFloat(taskItemStyles.paddingTop) || 0;
        const paddingBottom = parseFloat(taskItemStyles.paddingBottom) || 0;
        const gap = parseFloat(taskItemStyles.gap) || 0;

        // Account for gaps between elements (flexbox gap)
        const gapCount = [headerBars, taskHeader, descContainer, footerBars].filter(el => el).length - 1;
        const totalGap = gap * gapCount;

        // Calculate total used height
        usedHeight += (paddingTop + paddingBottom + totalGap);

        // Parse task height to pixels
        let taskHeightPx = 0;
        if (taskHeight.includes('vh')) {
            const vh = parseFloat(taskHeight);
            taskHeightPx = (vh / 100) * window.innerHeight;
        } else if (taskHeight.includes('px')) {
            taskHeightPx = parseFloat(taskHeight);
        } else if (taskHeight.includes('%')) {
            const percent = parseFloat(taskHeight);
            taskHeightPx = (percent / 100) * window.innerHeight;
        }

        // Calculate available height for description container
        const availableHeight = taskHeightPx - usedHeight;

        // Set the max-height for the description container
        if (availableHeight > 0) {
            descContainer.style.maxHeight = 'calc(' + availableHeight + 'px - var(--whitespace-div2))';
            descContainer.style.overflow = 'auto';
        } else {
            descContainer.style.maxHeight = '';
            descContainer.style.overflow = '';
        }
    });
}

function updateTaskMinHeight(value) {
    // Ensure we have a valid value
    if (!value) {
        value = 'auto';
    }

    // Convert value to CSS using getCSS helper
    const cssValue = getCSS('cardHeight', value);

    document.documentElement.style.setProperty('--task-height', cssValue);

    // Apply height limitation when value is not 'auto'
    if (value !== 'auto') {
        document.body.classList.add('task-height-limited');
    } else {
        document.body.classList.remove('task-height-limited');
    }

    // Add/remove class for tall task heights that interfere with sticky headers
    const isTallHeight = value === '50percent' || value === '100percent' ||
                         (value.includes('px') && parseInt(value) >= 400);

    if (isTallHeight) {
        document.body.classList.add('tall-task-height');
    } else {
        document.body.classList.remove('tall-task-height');
    }

    // Calculate task description heights after setting the height
    setTimeout(() => {
        calculateTaskDescriptionHeight();
    }, 0);
}

function updateMaxRowHeight(value) {
    // If value is 0, remove the max-height restriction
    if (value === 0) {
        document.documentElement.style.removeProperty('--max-row-height');
        document.documentElement.style.setProperty('--row-overflow', 'visible');
    } else {
        // Set the max-height value
        document.documentElement.style.setProperty('--max-row-height', value + 'px');
        document.documentElement.style.setProperty('--row-overflow', 'auto');
    }
}

// Export functions for use by other modules
window.calculateTaskDescriptionHeight = calculateTaskDescriptionHeight;
window.updateBorderStyles = updateBorderStyles;

// Make functions globally available
window.toggleFileBarMenu = toggleFileBarMenu;
window.toggleLayoutPresetsMenu = toggleLayoutPresetsMenu;
window.setColumnWidth = setColumnWidth;
window.applyColumnWidth = applyColumnWidth;
window.setLayoutRows = setLayoutRows;
window.setRowHeight = setRowHeight;
window.applyRowHeight = applyRowHeight;
window.currentRowHeight = currentRowHeight;
window.setTagVisibility = setTagVisibility;
window.applyTagVisibility = applyTagVisibility;
window.currentTagVisibility = currentTagVisibility;
window.filterTagsFromText = filterTagsFromText;
window.filterTagsForExport = filterTagsForExport;
window.updateColumnRowTag = updateColumnRowTag;
window.getColumnRow = getColumnRow;
window.sortColumnsByRow = sortColumnsByRow;

window.performSort = performSort;

// Font size functionality
let currentFontSize = '1x'; // Default to 1.0x (current behavior)

// Refactored font size functions using styleManager
function applyFontSize(size) {
    // Remove all font size classes
    fontSizeMultipliers.forEach(multiplier => {
        const safeName = multiplier.toString().replace('.', '_');
        document.body.classList.remove(`font-size-${safeName}x`);
    });

    document.body.classList.remove('small-card-fonts');
    document.body.classList.add(`font-size-${size}`);
    currentFontSize = size;
    window.currentFontSize = size;

    // Also use styleManager for consistency
    const multiplier = size.replace('x', '').replace('_', '.');
    styleManager.applyFontSize(parseFloat(multiplier) * 14);
}

function setFontSize(size) {
    applyAndSaveSetting('fontSize', size, applyFontSize);
}

// Font family functionality
let currentFontFamily = 'system'; // Default to system fonts

// Refactored font family functions using styleManager
function applyFontFamily(family) {
    // Remove all font family classes
    const families = ['system', 'roboto', 'opensans', 'lato', 'poppins', 'inter', 'helvetica', 'arial', 'georgia', 'times', 'firacode', 'jetbrains', 'sourcecodepro', 'consolas'];
    families.forEach(f => document.body.classList.remove(`font-family-${f}`));

    document.body.classList.add(`font-family-${family}`);
    currentFontFamily = family;
    window.currentFontFamily = family;

    // Map to actual font names for styleManager
    const fontMap = {
        'system': 'var(--vscode-font-family)',
        'roboto': "'Roboto', sans-serif",
        'opensans': "'Open Sans', sans-serif",
        'lato': "'Lato', sans-serif",
        'poppins': "'Poppins', sans-serif",
        'inter': "'Inter', sans-serif",
        'helvetica': "'Helvetica Neue', Helvetica, Arial, sans-serif",
        'arial': "Arial, sans-serif",
        'georgia': "Georgia, serif",
        'times': "'Times New Roman', serif",
        'firacode': "'Fira Code', monospace",
        'jetbrains': "'JetBrains Mono', monospace",
        'sourcecodepro': "'Source Code Pro', monospace",
        'consolas': "Consolas, monospace"
    };

    styleManager.applyFontFamily(fontMap[family] || fontMap['system']);
}

function setFontFamily(family) {
    applyAndSaveSetting('fontFamily', family, applyFontFamily);
}

// Legacy function for backward compatibility
function toggleCardFontSize() {
    const nextSize = currentFontSize === 'small' ? 'normal' : 'small';
    setFontSize(nextSize);
}

// Open include file function
function openIncludeFile(filePath) {
    if (typeof vscode !== 'undefined') {
        vscode.postMessage({
            type: 'openFileLink',
            href: filePath
        });
    }
}

// Make functions globally available
window.setFontSize = setFontSize;
window.toggleCardFontSize = toggleCardFontSize;
window.openIncludeFile = openIncludeFile;

/**
 * Lazy load videos using IntersectionObserver for better performance
 * Videos with preload="none" will only start loading metadata when visible
 */
function initializeVideoLazyLoading() {
    // Check if IntersectionObserver is supported
    if (!('IntersectionObserver' in window)) {
        return;
    }

    const videoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const video = entry.target;
                // Change preload from "none" to "metadata" when video comes into view
                // This loads the first frame and duration without loading the entire video
                if (video.preload === 'none') {
                    video.preload = 'metadata';
                }
                // Stop observing once we've triggered the load
                videoObserver.unobserve(video);
            }
        });
    }, {
        // Start loading when video is within 200px of viewport
        rootMargin: '200px',
        // Trigger when at least 10% of video is visible
        threshold: 0.1
    });

    // Observe all video elements
    const observeVideos = () => {
        document.querySelectorAll('video[preload="none"]').forEach(video => {
            videoObserver.observe(video);
        });
    };

    // Observe videos on initial load
    observeVideos();

    // Re-observe videos after board renders (use MutationObserver to catch new videos)
    const boardObserver = new MutationObserver(() => {
        observeVideos();
    });

    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardObserver.observe(boardElement, {
            childList: true,
            subtree: true
        });
    }
}

// Initialize font size on page load (wrapped in guard)
if (!webviewEventListenersInitialized) {
document.addEventListener('DOMContentLoaded', function() {
    // Set default font size (CSS classes are pre-defined in webview.css)
    setFontSize('1_0x');

    // Initialize video lazy loading for better performance with many videos
    initializeVideoLazyLoading();

    // Recalculate task description heights when window resizes (for vh units)
    window.addEventListener('resize', () => {
        if (document.body.classList.contains('task-height-limited')) {
            calculateTaskDescriptionHeight();
        }
    });

    // Handle clicks on included content icons (::before pseudo-element in top-right)
    document.addEventListener('click', function(e) {
        const includedContent = e.target.closest('.included-content-inline, .included-content-block');
        if (includedContent) {
            // Get the position of the click relative to the element
            const rect = includedContent.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            const iconSize = 20; // Icon area is approximately 20x20px (14px + padding)

            // Check if click is within the icon area (top-right corner)
            if (clickX >= rect.width - iconSize && clickY <= iconSize) {
                const filePath = includedContent.getAttribute('data-include-file');
                if (filePath) {
                    e.preventDefault();
                    e.stopPropagation();
                    openIncludeFile(filePath);
                }
            }
        }
    });

    // Add dynamic title on mousemove to show tooltip only on icon
    document.addEventListener('mousemove', function(e) {
        const includedContent = e.target.closest('.included-content-inline, .included-content-block');
        if (includedContent) {
            const rect = includedContent.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const iconSize = 20;
            const filePath = includedContent.getAttribute('data-include-file');

            // Show title only when hovering over the icon area (top-right corner)
            if (mouseX >= rect.width - iconSize && mouseY <= iconSize && filePath) {
                includedContent.title = `Open ${filePath}`;
            } else {
                includedContent.title = '';
            }
        }
    });

    // Initialize layout presets menu
    initializeLayoutPresetsMenu();
});
} // End of third webviewEventListenersInitialized guard

/**
 * Initialize the layout presets menu by populating it with preset options
 */
function initializeLayoutPresetsMenu() {
    const dropdown = document.getElementById('layout-presets-dropdown');
    if (!dropdown) { return; }

    // Clear existing content
    dropdown.innerHTML = '';

    // Add preset items
    Object.entries(layoutPresets).forEach(([presetKey, preset]) => {
        const item = document.createElement('button');
        item.className = 'layout-preset-item';
        item.setAttribute('data-preset', presetKey);
        item.onclick = () => applyLayoutPreset(presetKey);

        const label = document.createElement('div');
        label.className = 'layout-preset-label';
        label.textContent = preset.label;

        const description = document.createElement('div');
        description.className = 'layout-preset-description';
        description.textContent = preset.description;

        item.appendChild(label);
        item.appendChild(description);
        dropdown.appendChild(item);
    });

    // Update active state
    updateLayoutPresetsActiveState();
}

/**
 * Toggle the layout presets dropdown menu
 * @param {Event} event - Click event
 */
function toggleLayoutPresetsMenu(event) {
    if (event) {
        event.stopPropagation();
    }

    const dropdown = document.getElementById('layout-presets-dropdown');
    const button = document.getElementById('layout-presets-btn');

    if (!dropdown || !button) { return; }

    const isVisible = dropdown.classList.contains('show');

    // Close all other menus first
    closeAllMenus();

    if (!isVisible) {
        dropdown.classList.add('show');
        button.classList.add('active');

        // Position the dropdown below the button (fixed positioning)
        const buttonRect = button.getBoundingClientRect();
        dropdown.style.top = (buttonRect.bottom + 2) + 'px';
        dropdown.style.right = (window.innerWidth - buttonRect.right) + 'px';
        dropdown.style.left = 'auto';

        updateLayoutPresetsActiveState();

        // Close menu when clicking outside
        setTimeout(() => {
            document.addEventListener('click', function closeOnOutsideClick(e) {
                if (!dropdown.contains(e.target) && !button.contains(e.target)) {
                    dropdown.classList.remove('show');
                    button.classList.remove('active');
                    document.removeEventListener('click', closeOnOutsideClick);
                }
            });
        }, 0);
    }
}

/**
 * Apply a layout preset by setting all its configured options
 * @param {string} presetKey - The key of the preset to apply
 */
function applyLayoutPreset(presetKey) {
    const preset = layoutPresets[presetKey];
    if (!preset) { return; }

    // Track if any height-related settings changed
    let needsRecalculation = false;

    // Apply each setting in the preset
    Object.entries(preset.settings).forEach(([settingKey, value]) => {
        switch (settingKey) {
            case 'columnWidth':
                setColumnWidth(value);
                break;
            case 'cardHeight':
                setTaskMinHeight(value);
                needsRecalculation = true;
                break;
            case 'sectionHeight':
                setSectionHeight(value);
                needsRecalculation = true;
                break;
            case 'taskSectionHeight':
                setTaskSectionHeight(value);
                needsRecalculation = true;
                break;
            case 'fontSize':
                setFontSize(value);
                break;
            case 'fontFamily':
                setFontFamily(value);
                break;
            case 'layoutRows':
                setLayoutRows(value);
                needsRecalculation = true; // layoutRows already triggers renderBoard internally
                break;
            case 'rowHeight':
                setRowHeight(value);
                needsRecalculation = true;
                break;
            case 'stickyStackMode':
                setStickyStackMode(value);
                break;
            case 'tagVisibility':
                setTagVisibility(value);
                break;
            case 'htmlCommentRenderMode':
                setHtmlCommentRenderMode(value);
                break;
            case 'htmlContentRenderMode':
                setHtmlContentRenderMode(value);
                break;
            case 'whitespace':
                setWhitespace(value);
                break;
        }
    });

    // Store the current preset for backend config
    window.currentLayoutPreset = presetKey;

    // Send to backend
    vscode.postMessage({
        type: 'setPreference',
        key: 'layoutPreset',
        value: presetKey
    });

    // Close the menu
    const dropdown = document.getElementById('layout-presets-dropdown');
    const button = document.getElementById('layout-presets-btn');
    if (dropdown && button) {
        dropdown.classList.remove('show');
        button.classList.remove('active');
    }

    // Update all menu indicators
    updateAllMenuIndicators();
    updateLayoutPresetsActiveState();

    // Recalculate board layout if any height-related settings changed
    // Note: layoutRows already triggers renderBoard internally, but we need to ensure
    // other height changes also trigger recalculation
    if (needsRecalculation && currentBoard) {
        // Use setTimeout to ensure all CSS changes are applied first
        setTimeout(() => {
            renderBoard(); // Full board re-render to recalculate positions
        }, 50);
    }
}

/**
 * Update the active state indicators in the layout presets menu
 */
function updateLayoutPresetsActiveState() {
    const currentPreset = window.currentLayoutPreset || 'normal';

    // Update dropdown items
    const items = document.querySelectorAll('.layout-preset-item');
    items.forEach(item => {
        const presetKey = item.getAttribute('data-preset');
        item.classList.toggle('active', presetKey === currentPreset);
    });

    // Update button text to show current preset
    const button = document.getElementById('layout-presets-btn');
    const textSpan = button?.querySelector('.layout-presets-text');
    if (textSpan && layoutPresets[currentPreset]) {
        textSpan.textContent = layoutPresets[currentPreset].label;
    }
}


