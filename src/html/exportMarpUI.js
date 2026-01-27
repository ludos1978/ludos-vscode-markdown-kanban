/**
 * Export and Marp UI Module
 *
 * Handles all export dialog, Marp presentation settings, and auto-export functionality.
 * Extracted from webview.js for better code organization.
 */

// =============================================================================
// CONSTANTS (must match src/constants/FileNaming.ts)
// =============================================================================

/** Default export folder name - source of truth: FileNaming.DEFAULT_EXPORT_FOLDER */
const DEFAULT_EXPORT_FOLDER = '_Export';

// =============================================================================
// EXPORT FOLDER NAME GENERATION
// =============================================================================

/**
 * Generate export folder name based on current selection
 * Format: {shortfilename}-{export-range}-EXPORT-{timestamp}
 * @param {Array} selectedLabels - Array of selected column labels
 * @returns {string} The generated folder name (without workspace path)
 */
function generateExportFolderName(selectedLabels) {
    // Get short filename (16 chars max)
    const currentFilename = window.currentKanbanFile ?
        window.currentKanbanFile.split('/').pop().replace('.md', '') : 'kanban';
    const shortFilename = currentFilename.substring(0, 16);

    // Generate export range from selected columns (32 chars max)
    let exportRange;
    if (!selectedLabels || selectedLabels.length === 0) {
        exportRange = 'FULL';
    } else if (exportTreeUI && exportTreeUI.tree && exportTreeUI.tree.selected) {
        // All selected (root is selected)
        exportRange = 'FULL';
    } else {
        // Join column names, limit to 32 chars
        // Clean up special chars and join with underscores
        const cleanedLabels = selectedLabels.map(label =>
            label.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10)
        );
        exportRange = cleanedLabels.join('_').substring(0, 32);
        if (!exportRange) {
            exportRange = 'SELECTED';
        }
    }

    // Generate timestamp
    const timestamp = window.DateUtils.generateTimestamp();

    return `${shortFilename}-${exportRange}-EXPORT-${timestamp}`;
}

/**
 * Update the export folder input with generated name
 * Does not update if auto-export is active (live preview running)
 */
function updateExportFolderName() {
    // Don't regenerate if auto-export/live-preview is active
    if (autoExportActive) {
        return;
    }

    const folderInput = document.getElementById('export-folder');
    if (!folderInput) {
        return;
    }

    // Get selected column labels
    let selectedLabels = [];
    if (exportTreeUI && exportTreeUI.tree) {
        selectedLabels = window.ExportTreeBuilder.getSelectedColumnLabels(exportTreeUI.tree);
    }

    const workspacePath = getWorkspacePath();
    const folderName = generateExportFolderName(selectedLabels);
    folderInput.value = `${workspacePath}/${folderName}`;
}

// =============================================================================
// STATE VARIABLES
// =============================================================================

let exportDefaultFolder = '';
let exportTreeUI = null;
let lastExportSettings = null;
let autoExportActive = false;
let autoExportBrowserMode = false;
let exportUIListenersInitialized = false; // MEMORY: Prevent duplicate listeners

/**
 * Set up a select element to persist its value to localStorage on change
 * @param {string} elementId - The element ID
 * @param {string} storageKey - The localStorage key
 * @returns {HTMLElement|null} The element (for chaining)
 */
function setupStorageLinkedSelect(elementId, storageKey) {
    const element = document.getElementById(elementId);
    if (element) {
        element.addEventListener('change', () => {
            localStorage.setItem(storageKey, element.value);
        });
    }
    return element;
}

// =============================================================================
// EXPORT TAG FILTERING
// =============================================================================

/**
 * Helper function to filter tags from text based on export tag visibility setting
 */
function filterTagsForExport(text, tagVisibility = 'allexcludinglayout') {
    if (!text) {
        return text;
    }

    const setting = tagVisibility;

    switch (setting) {
        case 'all':
            // Export all tags - don't filter anything
            return text;
        case 'allexcludinglayout':
            // Export all except #span, #row, and #stack tags
            return text.replace(/#row\d+\b/gi, '').replace(/#span\d+\b/gi, '').replace(/#stack\b/gi, '').trim();
        case 'customonly':
            // Export only custom tags and @ tags (remove standard layout tags)
            return text.replace(/#row\d+\b/gi, '').replace(/#span\d+\b/gi, '').replace(/#stack\b/gi, '').trim();
        case 'mentionsonly':
            // Export only @ tags - remove all # tags
            return text.replace(/#\w+\b/gi, '').trim();
        case 'none':
            // Export no tags - remove all tags
            return text.replace(/#\w+\b/gi, '').replace(/@\w+\b/gi, '').trim();
        default:
            // Default to allexcludinglayout behavior
            return text.replace(/#row\d+\b/gi, '').replace(/#span\d+\b/gi, '').replace(/#stack\b/gi, '').trim();
    }
}

/**
 * Parse comma-separated exclude tags input into an array of normalized tags
 * Ensures each tag starts with # and trims whitespace
 * @param {string} input - Comma-separated tags (e.g., "#export-exclude, private, #draft")
 * @returns {string[]} Array of normalized tags (e.g., ["#export-exclude", "#private", "#draft"])
 */
function parseExcludeTags(input) {
    if (!input || !input.trim()) {
        return [];
    }
    return input
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
        .map(tag => tag.startsWith('#') ? tag : '#' + tag);
}

// =============================================================================
// EXPORT DIALOG FUNCTIONS
// =============================================================================

/**
 * Show the export dialog
 */
function showExportDialog() {
    showExportDialogWithSelection(null, null, null);
}

/**
 * Show export dialog with optional pre-selection
 * @param {string} scope - Scope to pre-select ('column', 'row', 'stack', or null for full)
 * @param {number} index - Index of the item to select
 * @param {string} id - ID of the item (for columns)
 */
function showExportDialogWithSelection(scope, index, id) {
    const modal = document.getElementById('export-modal');
    if (!modal) {
        return;
    }

    // Determine pre-selection node ID
    let preSelectNodeId = null;
    if (scope === 'column' && index !== null) {
        preSelectNodeId = `column-${index}`;
    } else if (scope === 'row' && index !== null) {
        preSelectNodeId = `row-${index}`;
    } else if (scope === 'stack' && index !== null) {
        preSelectNodeId = `stack-${index}`;
    }

    // Initialize export tree with pre-selection
    initializeExportTree(preSelectNodeId);

    // Restore previous export settings if available
    if (lastExportSettings && lastExportSettings.targetFolder) {
        const folderInput = document.getElementById('export-folder');
        if (folderInput) {
            folderInput.value = lastExportSettings.targetFolder;
            exportDefaultFolder = lastExportSettings.targetFolder;
        }
    } else {
        vscode.postMessage({
            type: 'getExportDefaultFolder'
        });
    }

    // Check Marp and Pandoc status when opening dialog
    checkMarpStatus();
    checkPandocStatus();

    // Add event listeners to detect manual setting changes
    addExportSettingChangeListeners();

    modal.style.display = 'block';
}

/**
 * Close the export dialog
 */
function closeExportModal() {
    const modal = document.getElementById('export-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Set the default export folder
 */
function setExportDefaultFolder(folderPath) {
    const folderInput = document.getElementById('export-folder');

    if (folderInput && (!folderInput.value || folderInput.value === exportDefaultFolder)) {
        folderInput.value = folderPath;
    }

    exportDefaultFolder = folderPath;
}

/**
 * Open folder selection dialog
 */
function selectExportFolder() {
    vscode.postMessage({
        type: 'selectExportFolder',
        defaultPath: exportDefaultFolder
    });
}

/**
 * Set the selected export folder
 */
function setSelectedExportFolder(folderPath) {
    exportDefaultFolder = folderPath;
    const folderInput = document.getElementById('export-folder');
    if (folderInput) {
        folderInput.value = folderPath;
        resetPresetToCustom();
    }
}

/**
 * Initialize export tree when modal opens
 * @param {string} preSelectNodeId - Optional node ID to pre-select instead of full kanban
 */
function initializeExportTree(preSelectNodeId = null) {
    if (!window.cachedBoard) {
        console.warn('[kanban.exportMarpUI.initializeExportTree] No board available');
        return;
    }

    if (!window.ExportTreeBuilder) {
        console.error('[kanban.exportMarpUI.initializeExportTree] ExportTreeBuilder not loaded');
        const container = document.getElementById('export-tree-container');
        if (container) {
            container.innerHTML = '<div class="export-tree-empty">Export tree not available. Please reload the page.</div>';
        }
        return;
    }

    const tree = window.ExportTreeBuilder.buildExportTree(window.cachedBoard);

    if (!exportTreeUI) {
        exportTreeUI = new window.ExportTreeUI('export-tree-container');
    }

    exportTreeUI.render(tree);

    // Load Marp themes when modal opens
    loadMarpThemes();

    // MEMORY FIX: Only set up listeners once to prevent duplicates on each modal open
    if (!exportUIListenersInitialized) {
        exportUIListenersInitialized = true;

        // Set up storage-linked select elements
        setupStorageLinkedSelect('marp-theme', 'kanban-marp-theme');
        setupStorageLinkedSelect('marp-browser', 'kanban-marp-browser');
        setupStorageLinkedSelect('speaker-note-mode', 'kanban-speaker-note-mode');
        setupStorageLinkedSelect('html-comment-mode', 'kanban-html-comment-mode');
        setupStorageLinkedSelect('html-content-mode', 'kanban-html-content-mode');
        setupStorageLinkedSelect('embed-handling', 'kanban-embed-handling');

        // Set up export exclude tags persistence
        const excludeEnabledCheckbox = document.getElementById('export-exclude-enabled');
        const excludeTagsInput = document.getElementById('export-exclude-tags');
        if (excludeEnabledCheckbox) {
            excludeEnabledCheckbox.addEventListener('change', () => {
                localStorage.setItem('kanban-export-exclude-enabled', excludeEnabledCheckbox.checked);
            });
        }
        if (excludeTagsInput) {
            excludeTagsInput.addEventListener('input', () => {
                localStorage.setItem('kanban-export-exclude-tags', excludeTagsInput.value);
            });
        }

        // Set up link handling mode dropdown
        const linkModeDropdown = document.getElementById('link-handling-mode');
        const linkHandlingOptions = document.getElementById('link-handling-options');
        const fileTypeOptions = document.getElementById('file-type-options');
        const fileSizeOption = document.getElementById('file-size-option');

        if (linkModeDropdown && linkHandlingOptions && fileTypeOptions && fileSizeOption) {
            linkModeDropdown.addEventListener('change', () => {
                updateLinkHandlingOptionsVisibility();
            });
        }
    }

    // Always update visibility state when modal opens
    updateLinkHandlingOptionsVisibility();

    // Restore export exclude settings from localStorage
    const excludeEnabledCheckbox = document.getElementById('export-exclude-enabled');
    const excludeTagsInput = document.getElementById('export-exclude-tags');
    if (excludeEnabledCheckbox) {
        const savedEnabled = localStorage.getItem('kanban-export-exclude-enabled');
        excludeEnabledCheckbox.checked = savedEnabled === 'true';
    }
    if (excludeTagsInput) {
        const savedTags = localStorage.getItem('kanban-export-exclude-tags');
        if (savedTags) {
            excludeTagsInput.value = savedTags;
        }
    }

    // Set up selection change callback to update folder name
    exportTreeUI.setSelectionChangeCallback(() => {
        updateExportFolderName();
    });

    // Select either the pre-selected node or full kanban
    if (preSelectNodeId) {
        exportTreeUI.tree = window.ExportTreeBuilder.toggleSelection(exportTreeUI.tree, preSelectNodeId, true);
        exportTreeUI.render(exportTreeUI.tree);
    } else {
        exportTreeUI.selectAll();
    }

    // Generate initial folder name based on selection
    updateExportFolderName();
}

/**
 * Update visibility of link handling options based on selected mode
 */
function updateLinkHandlingOptionsVisibility() {
    const linkModeDropdown = document.getElementById('link-handling-mode');
    const linkHandlingOptions = document.getElementById('link-handling-options');
    const fileTypeOptions = document.getElementById('file-type-options');
    const fileSizeOption = document.getElementById('file-size-option');

    if (!linkModeDropdown || !linkHandlingOptions || !fileTypeOptions || !fileSizeOption) {
        return;
    }

    const mode = linkModeDropdown.value;

    switch (mode) {
        case 'rewrite-only':
        case 'no-modify':
            linkHandlingOptions.classList.add('hidden');
            fileTypeOptions.classList.add('hidden');
            fileSizeOption.classList.add('hidden');
            break;

        case 'pack-linked':
            linkHandlingOptions.classList.remove('hidden');
            fileTypeOptions.classList.add('hidden');
            fileSizeOption.classList.remove('hidden');
            break;

        case 'pack-all':
            linkHandlingOptions.classList.remove('hidden');
            fileTypeOptions.classList.remove('hidden');
            fileSizeOption.classList.remove('hidden');
            break;

        default:
            linkHandlingOptions.classList.add('hidden');
            break;
    }
}

/**
 * Execute unified export
 */
function executeUnifiedExport() {
    // Stop existing auto-export and Marp processes before starting new export
    if (autoExportActive || lastExportSettings) {
        if (autoExportActive) {
            vscode.postMessage({
                type: 'stopAutoExport'
            });
        }

        autoExportActive = false;
        window.autoExportActive = false;
        autoExportBrowserMode = false;
        lastExportSettings = null;
        window.lastExportSettings = null;
    }

    const folderInput = document.getElementById('export-folder');
    if (!folderInput || !folderInput.value.trim()) {
        vscode.postMessage({
            type: 'showError',
            message: 'Please select an export folder'
        });
        return;
    }

    const selectedItems = exportTreeUI ? exportTreeUI.getSelectedItems() : [];
    if (selectedItems.length === 0) {
        vscode.postMessage({
            type: 'showError',
            message: 'Please select at least one item to export'
        });
        return;
    }

    const format = document.getElementById('export-format')?.value || 'keep';
    const tagVisibility = document.getElementById('export-tag-visibility')?.value || 'allexcludinglayout';
    const linkHandlingMode = document.getElementById('link-handling-mode')?.value || 'rewrite-only';

    // Export exclude tags
    const excludeEnabled = document.getElementById('export-exclude-enabled')?.checked || false;
    const excludeTagsRaw = document.getElementById('export-exclude-tags')?.value || '';
    const excludeTags = excludeEnabled ? parseExcludeTags(excludeTagsRaw) : [];

    let packAssets = false;
    let packOptions = undefined;

    if (linkHandlingMode === 'pack-linked' || linkHandlingMode === 'pack-all') {
        packAssets = true;
        packOptions = {
            fileSizeLimitMB: parseInt(document.getElementById('file-size-limit')?.value) || 100
        };

        if (linkHandlingMode === 'pack-all') {
            packOptions.includeFiles = document.getElementById('include-files')?.checked || false;
            packOptions.includeImages = document.getElementById('include-images')?.checked || false;
            packOptions.includeVideos = document.getElementById('include-videos')?.checked || false;
            packOptions.includeOtherMedia = document.getElementById('include-other-media')?.checked || false;
            packOptions.includeDocuments = document.getElementById('include-documents')?.checked || false;
        }
    }

    const mergeIncludes = document.getElementById('merge-includes')?.checked || false;
    const speakerNoteMode = document.getElementById('speaker-note-mode')?.value || 'comment';
    const htmlCommentMode = document.getElementById('html-comment-mode')?.value || 'remove';
    const htmlContentMode = document.getElementById('html-content-mode')?.value || 'keep';
    const embedHandling = document.getElementById('embed-handling')?.value || 'url';
    const autoExportOnSave = document.getElementById('auto-export-on-save')?.checked || false;
    const useMarp = document.getElementById('use-marp')?.checked || false;

    let marpOutputFormat = null;
    let marpTheme = null;
    let marpBrowser = null;
    let marpPreview = false;
    let marpPptxEditable = false;
    let marpHandout = false;
    let marpHandoutLayout = 'portrait';
    let marpHandoutSlidesPerPage = 1;
    let marpHandoutDirection = 'horizontal';

    if (useMarp) {
        marpOutputFormat = document.getElementById('marp-output-format')?.value || 'html';
        marpTheme = document.getElementById('marp-theme')?.value || 'default';
        marpBrowser = document.getElementById('marp-browser')?.value || 'chrome';
        marpPreview = document.getElementById('marp-preview')?.checked || false;
        marpPptxEditable = document.getElementById('marp-pptx-editable')?.checked || false;
        marpHandout = document.getElementById('marp-handout')?.checked || false;

        const handoutPreset = document.getElementById('marp-handout-preset')?.value || 'portrait-1';
        const [layout, slides] = handoutPreset.split('-');
        marpHandoutLayout = layout || 'portrait';
        marpHandoutSlidesPerPage = parseInt(slides || '1', 10);
        marpHandoutDirection = document.getElementById('marp-handout-direction')?.value || 'horizontal';
    }

    // Pandoc options
    const usePandoc = document.getElementById('use-pandoc')?.checked || false;
    let pandocFormat = null;
    let documentPageBreaks = 'continuous';

    if (usePandoc) {
        pandocFormat = document.getElementById('pandoc-output-format')?.value || 'docx';
        documentPageBreaks = document.getElementById('pandoc-page-breaks')?.value || 'continuous';
    }

    closeExportModal();

    const options = {
        columnIndexes: selectedItems,
        mode: (useMarp && marpPreview) ? 'auto' : 'save',
        format: format,  // 'keep', 'kanban', 'presentation', or 'document'
        runMarp: useMarp,  // Use Marp checkbox
        marpFormat: useMarp ? marpOutputFormat : undefined,
        tagVisibility: tagVisibility,
        excludeTags: excludeTags.length > 0 ? excludeTags : undefined,
        mergeIncludes: mergeIncludes,
        speakerNoteMode: speakerNoteMode,
        htmlCommentMode: htmlCommentMode,
        htmlContentMode: htmlContentMode,
        embedHandling: embedHandling,
        linkHandlingMode: linkHandlingMode,
        packAssets: packAssets,
        packOptions: packOptions,
        targetFolder: folderInput.value.trim(),
        openAfterExport: false,
        marpTheme: useMarp ? marpTheme : undefined,
        marpBrowser: useMarp ? marpBrowser : undefined,
        marpWatch: useMarp && marpPreview ? true : undefined,
        marpPptxEditable: useMarp && marpPptxEditable ? true : undefined,
        marpHandout: useMarp && marpHandout ? true : undefined,
        marpHandoutLayout: useMarp && marpHandout ? marpHandoutLayout : undefined,
        marpHandoutSlidesPerPage: useMarp && marpHandout ? marpHandoutSlidesPerPage : undefined,
        marpHandoutDirection: useMarp && marpHandout ? marpHandoutDirection : undefined,
        marpHandoutPdf: useMarp && marpHandout ? true : undefined,
        // Pandoc options
        runPandoc: usePandoc,
        pandocFormat: usePandoc ? pandocFormat : undefined,
        documentPageBreaks: usePandoc ? documentPageBreaks : undefined
    };

    lastExportSettings = options;
    window.lastExportSettings = options;

    vscode.postMessage({
        type: 'export',
        options: options
    });

    autoExportBrowserMode = useMarp && marpPreview;

    const shouldActivateAutoExport = autoExportOnSave || (useMarp && marpPreview);
    if (lastExportSettings && shouldActivateAutoExport) {
        autoExportActive = true;
        window.autoExportActive = true;
        updateAutoExportButton();
    }

    if (autoExportOnSave && lastExportSettings) {
        const autoOptions = {
            ...lastExportSettings,
            mode: 'auto'
        };
        vscode.postMessage({
            type: 'export',
            options: autoOptions
        });
    }
}

/**
 * Handle export result
 */
function handleExportResult(result) {
    if (result.success) {
        vscode.postMessage({
            type: 'showInfo',
            message: result.message
        });

        if (result.exportedPath) {
            vscode.postMessage({
                type: 'askOpenExportFolder',
                path: result.exportedPath
            });
        }
    } else {
        vscode.postMessage({
            type: 'showError',
            message: result.message
        });
    }
}

/**
 * Get workspace path from current file
 */
function getWorkspacePath() {
    if (window.currentFilePath) {
        const pathParts = window.currentFilePath.split('/');
        // Join preserves empty string at start, so no need to add leading slash
        const directoryPath = pathParts.slice(0, -1).join('/');
        return directoryPath;
    }
    return DEFAULT_EXPORT_FOLDER;
}

// =============================================================================
// EXPORT FORMAT HANDLERS
// =============================================================================

/**
 * Handle export format change - enable/disable Marp and Pandoc options
 */
function handleFormatChange() {
    const formatSelect = document.getElementById('export-format');
    const useMarpCheckbox = document.getElementById('use-marp');
    const useMarpHint = document.getElementById('use-marp-hint');
    const marpOptions = document.getElementById('marp-options');
    const contentTransformations = document.getElementById('content-transformations');
    const usePandocCheckbox = document.getElementById('use-pandoc');
    const usePandocHint = document.getElementById('use-pandoc-hint');
    const pandocOptions = document.getElementById('pandoc-options');

    if (formatSelect && useMarpCheckbox && marpOptions) {
        const format = formatSelect.value;
        const isPresentationFormat = format === 'presentation';
        const isDocumentFormat = format === 'document';

        // Handle Marp - only enabled for presentation format
        if (isPresentationFormat) {
            useMarpCheckbox.disabled = false;
            if (useMarpHint) useMarpHint.classList.add('hidden');

            if (contentTransformations) {
                contentTransformations.classList.remove('hidden');
            }

            if (useMarpCheckbox.checked) {
                marpOptions.classList.remove('disabled-section');
                checkMarpStatus();
            } else {
                marpOptions.classList.add('disabled-section');
            }
        } else {
            useMarpCheckbox.disabled = true;
            useMarpCheckbox.checked = false;
            if (useMarpHint) useMarpHint.classList.remove('hidden');

            if (contentTransformations) {
                contentTransformations.classList.add('hidden');
            }

            marpOptions.classList.add('disabled-section');
        }

        // Handle Pandoc - only enabled for document format
        if (usePandocCheckbox && pandocOptions) {
            if (isDocumentFormat) {
                usePandocCheckbox.disabled = false;
                if (usePandocHint) usePandocHint.classList.add('hidden');

                if (usePandocCheckbox.checked) {
                    pandocOptions.classList.remove('disabled-section');
                    checkPandocStatus();
                } else {
                    pandocOptions.classList.add('disabled-section');
                }
            } else {
                usePandocCheckbox.disabled = true;
                usePandocCheckbox.checked = false;
                if (usePandocHint) usePandocHint.classList.remove('hidden');

                pandocOptions.classList.add('disabled-section');
            }
        }
    }
}

/**
 * Handle Use Marp checkbox change
 */
function handleUseMarpChange() {
    const useMarpCheckbox = document.getElementById('use-marp');
    const marpOptions = document.getElementById('marp-options');

    if (useMarpCheckbox && marpOptions) {
        if (useMarpCheckbox.checked) {
            marpOptions.classList.remove('disabled-section');
            checkMarpStatus();
            handleMarpOutputFormatChange();
        } else {
            marpOptions.classList.add('disabled-section');
        }
    }
}

/**
 * Handle Marp output format change
 */
function handleMarpOutputFormatChange() {
    const outputFormatSelect = document.getElementById('marp-output-format');
    const pptxEditableCheckbox = document.getElementById('marp-pptx-editable');
    const previewCheckbox = document.getElementById('marp-preview');
    const handoutCheckbox = document.getElementById('marp-handout');
    const handoutRow = document.getElementById('marp-handout-row');

    if (outputFormatSelect && pptxEditableCheckbox) {
        const isHtml = outputFormatSelect.value === 'html';
        const isPptx = outputFormatSelect.value === 'pptx';
        const isPdf = outputFormatSelect.value === 'pdf';

        if (previewCheckbox) {
            if (isHtml) {
                previewCheckbox.disabled = false;
            } else {
                previewCheckbox.disabled = true;
                previewCheckbox.checked = false;
            }
        }

        if (isPptx) {
            pptxEditableCheckbox.disabled = false;
        } else {
            pptxEditableCheckbox.disabled = true;
            pptxEditableCheckbox.checked = false;
        }

        if (handoutCheckbox && handoutRow) {
            if (isPdf) {
                handoutCheckbox.disabled = false;
                handoutRow.classList.remove('faded');
                handoutRow.title = '';
            } else {
                handoutCheckbox.disabled = true;
                handoutCheckbox.checked = false;
                handoutRow.classList.add('faded');
                handoutRow.title = 'Handout is only available for PDF format';
                handleMarpHandoutChange();
            }
        }
    }
}

/**
 * Handle Marp handout mode change
 */
function handleMarpHandoutChange() {
    const handoutCheckbox = document.getElementById('marp-handout');
    const layoutContainer = document.getElementById('handout-layout-container');
    const directionContainer = document.getElementById('handout-direction-container');

    if (handoutCheckbox && layoutContainer) {
        layoutContainer.classList.toggle('hidden', !handoutCheckbox.checked);
        handleMarpHandoutPresetChange();
    }
    if (!handoutCheckbox?.checked && directionContainer) {
        directionContainer.classList.add('hidden');
    }
}

/**
 * Handle Marp handout preset change
 */
function handleMarpHandoutPresetChange() {
    const handoutCheckbox = document.getElementById('marp-handout');
    const presetSelect = document.getElementById('marp-handout-preset');
    const directionContainer = document.getElementById('handout-direction-container');

    if (handoutCheckbox && presetSelect && directionContainer) {
        const show2SlideOptions = handoutCheckbox.checked && presetSelect.value === 'landscape-2';
        directionContainer.classList.toggle('hidden', !show2SlideOptions);
    }
}

// =============================================================================
// EXPORT PRESETS
// =============================================================================

/**
 * Apply export preset configuration
 */
function applyExportPreset() {
    const presetSelect = document.getElementById('export-preset');
    if (!presetSelect) {
        return;
    }

    const preset = presetSelect.value;
    if (!preset) {
        return;
    }

    switch (preset) {
        case 'marp-presentation':
            applyPresetMarpPresentation();
            break;
        case 'marp-pdf':
            applyPresetMarpPdf();
            break;
        case 'share-content':
            applyPresetShareContent();
            break;
    }

    handleFormatChange();
}

/**
 * Apply Marp Presentation preset
 */
function applyPresetMarpPresentation() {
    document.getElementById('export-format').value = 'presentation';
    document.getElementById('merge-includes').checked = false;
    document.getElementById('export-tag-visibility').value = 'none';
    document.getElementById('auto-export-on-save').checked = true;
    document.getElementById('use-marp').checked = true;
    document.getElementById('marp-output-format').value = 'html';
    document.getElementById('marp-browser').value = 'chrome';
    document.getElementById('marp-preview').checked = true;
    document.getElementById('marp-pptx-editable').checked = false;

    document.getElementById('link-handling-mode').value = 'rewrite-only';
    updateLinkHandlingOptionsVisibility();
    handleMarpOutputFormatChange();
    updateExportFolderName();
}

/**
 * Apply Marp PDF preset
 */
function applyPresetMarpPdf() {
    document.getElementById('export-format').value = 'presentation';
    document.getElementById('merge-includes').checked = false;
    document.getElementById('export-tag-visibility').value = 'none';
    document.getElementById('auto-export-on-save').checked = true;
    document.getElementById('use-marp').checked = true;
    document.getElementById('marp-output-format').value = 'pdf';
    document.getElementById('marp-browser').value = 'chrome';
    document.getElementById('marp-preview').checked = false;
    document.getElementById('marp-pptx-editable').checked = false;
    document.getElementById('speaker-note-mode').value = 'keep';

    document.getElementById('link-handling-mode').value = 'rewrite-only';
    updateLinkHandlingOptionsVisibility();
    handleMarpOutputFormatChange();
    updateExportFolderName();
}

/**
 * Apply Share Content preset
 */
function applyPresetShareContent() {
    document.getElementById('export-format').value = 'keep';
    document.getElementById('merge-includes').checked = false;
    document.getElementById('export-tag-visibility').value = 'all';
    document.getElementById('auto-export-on-save').checked = false;
    document.getElementById('use-marp').checked = false;

    document.getElementById('link-handling-mode').value = 'pack-all';
    updateLinkHandlingOptionsVisibility();

    document.getElementById('include-files').checked = true;
    document.getElementById('include-images').checked = true;
    document.getElementById('include-videos').checked = true;
    document.getElementById('include-other-media').checked = true;
    document.getElementById('include-documents').checked = true;
    document.getElementById('file-size-limit').value = 100;
    updateExportFolderName();
}

/**
 * Save current export settings as last used
 */
function saveLastExportSettings() {
    const folderInput = document.getElementById('export-folder');
    const formatSelect = document.getElementById('export-format');
    const tagVisibilitySelect = document.getElementById('export-tag-visibility');
    const mergeIncludesCheckbox = document.getElementById('merge-includes');
    const autoExportCheckbox = document.getElementById('auto-export-on-save');
    const useMarpCheckbox = document.getElementById('use-marp');
    const linkModeDropdown = document.getElementById('link-handling-mode');

    if (!folderInput || !formatSelect || !tagVisibilitySelect) {
        return;
    }

    const linkHandlingMode = linkModeDropdown?.value || 'rewrite-only';

    let packAssets = false;
    let packOptions = undefined;

    if (linkHandlingMode === 'pack-linked' || linkHandlingMode === 'pack-all') {
        packAssets = true;
        packOptions = {
            fileSizeLimitMB: parseInt(document.getElementById('file-size-limit')?.value) || 100
        };

        if (linkHandlingMode === 'pack-all') {
            packOptions.includeFiles = document.getElementById('include-files')?.checked || false;
            packOptions.includeImages = document.getElementById('include-images')?.checked || false;
            packOptions.includeVideos = document.getElementById('include-videos')?.checked || false;
            packOptions.includeOtherMedia = document.getElementById('include-other-media')?.checked || false;
            packOptions.includeDocuments = document.getElementById('include-documents')?.checked || false;
        }
    }

    lastExportSettings = {
        targetFolder: folderInput.value.trim(),
        format: formatSelect.value,
        tagVisibility: tagVisibilitySelect.value,
        mergeIncludes: mergeIncludesCheckbox?.checked || false,
        autoExportOnSave: autoExportCheckbox?.checked || false,
        useMarp: useMarpCheckbox?.checked || false,
        linkHandlingMode: linkHandlingMode,
        packAssets: packAssets,
        packOptions: packOptions,
        marpOutputFormat: document.getElementById('marp-output-format')?.value || 'html',
        marpTheme: document.getElementById('marp-theme')?.value || 'default',
        marpBrowser: document.getElementById('marp-browser')?.value || 'chrome',
        marpPreview: document.getElementById('marp-preview')?.checked || false,
        marpPptxEditable: document.getElementById('marp-pptx-editable')?.checked || false
    };

    window.lastExportSettings = lastExportSettings;
}

/**
 * Reset preset to Custom Settings when user manually changes options
 */
function resetPresetToCustom() {
    const presetSelect = document.getElementById('export-preset');
    if (presetSelect && presetSelect.value !== '') {
        presetSelect.value = '';
    }
}

/**
 * Add event listeners to detect manual changes and reset preset
 */
let exportSettingListenersInitialized = false; // MEMORY: Prevent duplicate listeners

function addExportSettingChangeListeners() {
    // MEMORY FIX: Only set up listeners once
    if (exportSettingListenersInitialized) {
        return;
    }
    exportSettingListenersInitialized = true;

    const elements = [
        'export-format', 'export-tag-visibility', 'merge-includes',
        'auto-export-on-save', 'use-marp', 'link-handling-mode',
        'marp-output-format', 'marp-theme', 'marp-browser', 'marp-preview', 'marp-pptx-editable',
        'include-files', 'include-images', 'include-videos',
        'include-other-media', 'include-documents', 'file-size-limit'
    ];

    elements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            if (element.type === 'checkbox') {
                element.addEventListener('change', resetPresetToCustom);
            } else {
                element.addEventListener('input', resetPresetToCustom);
                element.addEventListener('change', resetPresetToCustom);
            }
        }
    });
}

// =============================================================================
// MARP STATUS AND THEMES
// =============================================================================

/**
 * Check Marp CLI and extension status
 */
function checkMarpStatus() {
    vscode.postMessage({
        type: 'checkMarpStatus'
    });
}

/**
 * Handle Marp status response from backend
 */
function handleMarpStatus(status) {
    const statusText = document.getElementById('marp-status-text');
    const enginePathEl = document.getElementById('marp-engine-path');
    if (!statusText) {
        console.error('[kanban.exportMarpUI] marp-status-text element not found');
        return;
    }

    statusText.className = 'status-text';

    if (status.cliAvailable && status.extensionInstalled) {
        statusText.textContent = '✓ Ready';
        statusText.classList.add('status-success');
    } else if (!status.cliAvailable && !status.extensionInstalled) {
        statusText.textContent = '⚠ CLI & Extension Missing';
        statusText.classList.add('status-warning');
    } else if (!status.cliAvailable) {
        statusText.textContent = '⚠ CLI Missing';
        statusText.classList.add('status-warning');
    } else if (!status.extensionInstalled) {
        statusText.textContent = '⚠ Extension Missing';
        statusText.classList.add('status-warning');
    } else {
        statusText.textContent = '⚠ Unknown Status';
        statusText.classList.add('status-warning');
    }

    if (enginePathEl && status.enginePath) {
        const engineExists = status.engineFileExists ? '✓' : '✗';
        enginePathEl.textContent = `Engine: ${engineExists} ${status.enginePath}`;
        enginePathEl.title = status.enginePath;
    }
}

/**
 * Handle Marp available classes response
 */
function handleMarpAvailableClasses(classes) {
    window.marpAvailableClasses = classes;
}

// =============================================================================
// PANDOC STATUS
// =============================================================================

/**
 * Check Pandoc availability
 */
function checkPandocStatus() {
    vscode.postMessage({
        type: 'checkPandocStatus'
    });
}

/**
 * Handle Pandoc status response from backend
 */
function handlePandocStatus(status) {
    const statusText = document.getElementById('pandoc-status-text');
    const usePandocCheckbox = document.getElementById('use-pandoc');
    const pandocOptions = document.getElementById('pandoc-options');
    const formatSelect = document.getElementById('export-format');

    if (!statusText) {
        return;
    }

    statusText.className = 'status-text';

    if (status.available) {
        statusText.textContent = status.version ? `✓ Ready (v${status.version})` : '✓ Ready';
        statusText.classList.add('status-success');
        // Only enable checkbox if format is 'document' (respects format selection)
        if (usePandocCheckbox && formatSelect && formatSelect.value === 'document') {
            usePandocCheckbox.disabled = false;
        }
    } else {
        statusText.innerHTML = '⚠ Not Installed - <a href="https://pandoc.org/installing.html" target="_blank">Install</a>';
        statusText.classList.add('status-warning');
        if (usePandocCheckbox) {
            usePandocCheckbox.disabled = true;
            usePandocCheckbox.checked = false;
        }
        if (pandocOptions) {
            pandocOptions.classList.add('disabled-section');
        }
    }
}

/**
 * Handle Use Pandoc checkbox change
 */
function handleUsePandocChange() {
    const usePandocCheckbox = document.getElementById('use-pandoc');
    const pandocOptions = document.getElementById('pandoc-options');
    const useMarpCheckbox = document.getElementById('use-marp');

    if (usePandocCheckbox && pandocOptions) {
        if (usePandocCheckbox.checked) {
            pandocOptions.classList.remove('disabled-section');
            // Uncheck Marp when Pandoc is selected (mutually exclusive)
            if (useMarpCheckbox) {
                useMarpCheckbox.checked = false;
                handleUseMarpChange();
            }
        } else {
            pandocOptions.classList.add('disabled-section');
        }
    }
}

/**
 * Handle Marp themes available response from backend
 */
function handleMarpThemesAvailable(themes, error) {
    const themeSelect = document.getElementById('marp-theme');
    if (!themeSelect) {
        console.error('[kanban.exportMarpUI] marp-theme select element not found');
        return;
    }

    while (themeSelect.children.length > 1) {
        themeSelect.removeChild(themeSelect.lastChild);
    }

    if (error) {
        console.error('[kanban.exportMarpUI] Error loading Marp themes:', error);
        const errorOption = document.createElement('option');
        errorOption.value = 'default';
        errorOption.textContent = 'Default (Error loading themes)';
        errorOption.disabled = true;
        themeSelect.appendChild(errorOption);
        return;
    }

    themes.forEach(theme => {
        const option = document.createElement('option');
        option.value = theme;
        option.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
        themeSelect.appendChild(option);
    });

    const savedTheme = localStorage.getItem('kanban-marp-theme');
    if (savedTheme && themes.includes(savedTheme)) {
        themeSelect.value = savedTheme;
    }

    const savedBrowser = localStorage.getItem('kanban-marp-browser');
    const browserSelect = document.getElementById('marp-browser');
    if (savedBrowser && browserSelect) {
        browserSelect.value = savedBrowser;
    }

    const savedSpeakerNoteMode = localStorage.getItem('kanban-speaker-note-mode');
    const speakerNoteSelect = document.getElementById('speaker-note-mode');
    if (savedSpeakerNoteMode && speakerNoteSelect) {
        speakerNoteSelect.value = savedSpeakerNoteMode;
    }

    const savedHtmlCommentMode = localStorage.getItem('kanban-html-comment-mode');
    const htmlCommentSelect = document.getElementById('html-comment-mode');
    if (savedHtmlCommentMode && htmlCommentSelect) {
        htmlCommentSelect.value = savedHtmlCommentMode;
    }

    const savedHtmlContentMode = localStorage.getItem('kanban-html-content-mode');
    const htmlContentSelect = document.getElementById('html-content-mode');
    if (savedHtmlContentMode && htmlContentSelect) {
        htmlContentSelect.value = savedHtmlContentMode;
    }
}

/**
 * Load Marp themes from backend
 */
function loadMarpThemes() {
    vscode.postMessage({
        type: 'getMarpThemes'
    });
}

// =============================================================================
// MARP CLASSES AND DIRECTIVES
// =============================================================================

/**
 * Get Marp classes for an element by parsing its title
 */
function getMarpClassesForElement(scope, id, columnId) {
    if (scope === 'global') {
        const currentValue = window.cachedBoard?.frontmatter?.class || '';
        const classes = currentValue.split(/\s+/).filter(c => c.trim() !== '');
        return classes;
    }

    let element = null;

    if (scope === 'column') {
        const column = window.cachedBoard?.columns?.find(c => c.id === id);
        element = column;
    } else if (scope === 'task' && columnId) {
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === id);
        element = task;
    }

    if (!element || !element.title) {
        return [];
    }

    const title = element.title;
    const commentRegex = /<!--\s*(_?class):\s*([^>]+?)\s*-->/g;
    const classes = [];
    let match;

    while ((match = commentRegex.exec(title)) !== null) {
        const classString = match[2].trim();
        const classNames = classString.split(/\s+/).filter(c => c.length > 0);
        classes.push(...classNames);
    }

    return classes;
}

/**
 * Check if a Marp directive is active for an element
 */
function isMarpDirectiveActive(scope, id, columnId, directiveName) {
    if (scope === 'global') {
        return false;
    }

    let element = null;

    if (scope === 'column') {
        const column = window.cachedBoard?.columns?.find(c => c.id === id);
        element = column;
    } else if (scope === 'task' && columnId) {
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === id);
        element = task;
    }

    if (!element || !element.title) {
        return false;
    }

    const directiveRegex = new RegExp(`<!--\\s*${directiveName}:\\s*[^>]+\\s*-->`, 'g');
    return directiveRegex.test(element.title);
}

/**
 * Set any Marp directive
 */
function setMarpDirective(scope, id, columnId, directiveName, value, directiveScope) {
    if (scope === 'global' || !value || !value.trim()) {
        return;
    }

    let element = null;
    let type = '';

    if (scope === 'column') {
        type = 'column';
        const column = window.cachedBoard?.columns?.find(c => c.id === id);
        element = column;
    } else if (scope === 'task' && columnId) {
        type = 'task';
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === id);
        element = task;
    }

    if (!element) {
        return;
    }

    let title = element.title || '';
    const cleanValue = value.trim();

    const isScoped = directiveScope === 'scoped';
    const finalDirectiveName = isScoped ? `_${directiveName}` : directiveName;

    const targetRegex = new RegExp(`<!--\\s*${finalDirectiveName}:\\s*[^>]+\\s*-->`, 'g');
    title = title.replace(targetRegex, '');

    const newDirective = `<!-- ${finalDirectiveName}: ${cleanValue} -->`;
    title = `${title} ${newDirective}`.trim();

    element.title = title;

    if (type === 'column' && element.includeMode && element.includeFiles && element.includeFiles.length > 0) {
        element.displayTitle = window.createDisplayTitleWithPlaceholders(title, element.includeFiles);
    }

    if (type === 'column') {
        if (!window.pendingColumnChanges) {
            window.pendingColumnChanges = new Map();
        }
        window.pendingColumnChanges.set(id, { title: title, columnId: id });

        if (typeof updateColumnDisplayImmediate === 'function') {
            updateColumnDisplayImmediate(id, title, false, '');
        }
    } else if (type === 'task') {
        vscode.postMessage({
            type: 'editTask',
            taskId: id,
            columnId: columnId,
            taskData: element
        });

        if (typeof updateTaskDisplayImmediate === 'function') {
            updateTaskDisplayImmediate(id, title, false, '');
        }
    }

    const totalPending = (window.pendingColumnChanges?.size || 0);
    if (typeof updateRefreshButtonState === 'function') {
        updateRefreshButtonState(totalPending > 0 ? 'unsaved' : 'default', totalPending);
    }

    refreshMarpDirectivesSubmenu(scope, id, type, columnId);
}

/**
 * Toggle a boolean Marp directive
 */
function toggleMarpDirective(scope, id, columnId, directiveName, defaultValue, directiveScope) {
    if (scope === 'global') {
        return;
    }

    let element = null;
    let type = '';

    if (scope === 'column') {
        type = 'column';
        const column = window.cachedBoard?.columns?.find(c => c.id === id);
        element = column;
    } else if (scope === 'task' && columnId) {
        type = 'task';
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === id);
        element = task;
    }

    if (!element) {
        return;
    }

    let title = element.title || '';

    const isScoped = directiveScope === 'scoped';
    const finalDirectiveName = isScoped ? `_${directiveName}` : directiveName;

    const targetRegex = new RegExp(`<!--\\s*${finalDirectiveName}:\\s*([^>]+)\\s*-->`, 'g');
    const hasDirective = title.match(targetRegex);

    if (hasDirective) {
        title = title.replace(targetRegex, '').replace(/\s+/g, ' ').trim();
    } else {
        const newDirective = `<!-- ${finalDirectiveName}: ${defaultValue} -->`;
        title = `${title} ${newDirective}`.trim();
    }

    element.title = title;

    if (type === 'column' && element.includeMode && element.includeFiles && element.includeFiles.length > 0) {
        element.displayTitle = window.createDisplayTitleWithPlaceholders(title, element.includeFiles);
    }

    if (type === 'column') {
        if (!window.pendingColumnChanges) {
            window.pendingColumnChanges = new Map();
        }
        window.pendingColumnChanges.set(id, { title: title, columnId: id });

        if (typeof updateColumnDisplayImmediate === 'function') {
            updateColumnDisplayImmediate(id, title, false, '');
        }
    } else if (type === 'task') {
        vscode.postMessage({
            type: 'editTask',
            taskId: id,
            columnId: columnId,
            taskData: element
        });

        if (typeof updateTaskDisplayImmediate === 'function') {
            updateTaskDisplayImmediate(id, title, false, '');
        }
    }

    const totalPending = (window.pendingColumnChanges?.size || 0);
    if (typeof updateRefreshButtonState === 'function') {
        updateRefreshButtonState(totalPending > 0 ? 'unsaved' : 'default', totalPending);
    }

    refreshMarpDirectivesSubmenu(scope, id, type, columnId);
}

/**
 * Refresh the Marp Directives submenu to show current state
 */
function refreshMarpDirectivesSubmenu(scope, id, type, columnId) {
    const openSubmenu = document.querySelector('.donut-menu-submenu[data-submenu-type^="marp-"]');

    if (!openSubmenu) {
        console.warn('No open Marp submenu found');
        return;
    }

    const submenuType = openSubmenu.getAttribute('data-submenu-type');

    if (window.menuManager) {
        let newContent = '';

        if (submenuType === 'marp-classes' && typeof window.menuManager.createMarpClassesContent === 'function') {
            newContent = window.menuManager.createMarpClassesContent(scope, id, type, columnId);
        } else if (submenuType === 'marp-colors' && typeof window.menuManager.createMarpColorsContent === 'function') {
            newContent = window.menuManager.createMarpColorsContent(scope, id, type, columnId);
        } else if (submenuType === 'marp-header-footer' && typeof window.menuManager.createMarpHeaderFooterContent === 'function') {
            newContent = window.menuManager.createMarpHeaderFooterContent(scope, id, type, columnId);
        } else if (submenuType === 'marp-theme' && typeof window.menuManager.createMarpThemeContent === 'function') {
            newContent = window.menuManager.createMarpThemeContent(scope, id, type, columnId);
        }

        if (newContent) {
            openSubmenu.innerHTML = newContent;
        } else {
            console.warn('No new content generated for submenu type:', submenuType);
        }
    } else {
        console.warn('window.menuManager not available');
    }
}

/**
 * Toggle Marp class on column/task/global
 */
function toggleMarpClass(scope, id, columnId, className, classScope) {
    if (scope === 'global') {
        const currentValue = window.cachedBoard?.frontmatter?.class || '';
        const classes = currentValue.split(/\s+/).filter(c => c.trim() !== '');

        const index = classes.indexOf(className);
        if (index > -1) {
            classes.splice(index, 1);
        } else {
            classes.push(className);
        }

        const newValue = classes.join(' ');
        updateMarpGlobalSetting('class', newValue);

        populateMarpGlobalMenu();
        return;
    }

    let element = null;
    let type = '';

    if (scope === 'column') {
        type = 'column';
        const column = window.cachedBoard?.columns?.find(c => c.id === id);
        element = column;
    } else if (scope === 'task' && columnId) {
        type = 'task';
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === id);
        element = task;
    }

    if (!element) {
        return;
    }

    let title = element.title || '';

    const isScoped = classScope === 'scoped';
    const directiveName = isScoped ? '_class' : 'class';

    const commentRegex = new RegExp(`<!--\\s*${directiveName}:\\s*([^>]+?)\\s*-->`);
    const match = title.match(commentRegex);

    let classes = [];

    if (match) {
        const classString = match[1].trim();
        classes = classString.split(/\s+/).filter(c => c.length > 0);
    }

    const classIndex = classes.indexOf(className);
    if (classIndex > -1) {
        classes.splice(classIndex, 1);
    } else {
        classes.push(className);
    }

    if (classes.length > 0) {
        const newComment = `<!-- ${directiveName}: ${classes.join(' ')} -->`;
        if (match) {
            title = title.replace(commentRegex, newComment);
        } else {
            title = `${title} ${newComment}`.trim();
        }
    } else {
        if (match) {
            title = title.replace(commentRegex, '').replace(/\s+/g, ' ').trim();
        }
    }

    element.title = title;

    if (type === 'column' && element.includeMode && element.includeFiles && element.includeFiles.length > 0) {
        element.displayTitle = window.createDisplayTitleWithPlaceholders(title, element.includeFiles);
    }

    if (type === 'column') {
        if (!window.pendingColumnChanges) {
            window.pendingColumnChanges = new Map();
        }
        window.pendingColumnChanges.set(id, { title: title, columnId: id });

        if (typeof updateColumnDisplayImmediate === 'function') {
            updateColumnDisplayImmediate(id, title, false, '');
        }
    } else if (type === 'task') {
        vscode.postMessage({
            type: 'editTask',
            taskId: id,
            columnId: columnId,
            taskData: element
        });

        if (typeof updateTaskDisplayImmediate === 'function') {
            updateTaskDisplayImmediate(id, title, false, '');
        }
    }

    const totalPending = (window.pendingColumnChanges?.size || 0);
    if (typeof updateRefreshButtonState === 'function') {
        updateRefreshButtonState(totalPending > 0 ? 'unsaved' : 'default', totalPending);
    }

    refreshMarpDirectivesSubmenu(scope, id, type, columnId);
}

// =============================================================================
// AUTO-EXPORT
// =============================================================================

/**
 * Toggle auto-export on/off
 */
function toggleAutoExport() {
    if (!lastExportSettings) {
        vscode.postMessage({
            type: 'showInfo',
            message: 'No previous export settings found. Please export first to enable auto-export.'
        });
        showExportDialog();
        return;
    }

    autoExportActive = !autoExportActive;
    window.autoExportActive = autoExportActive;

    updateAutoExportButton();

    if (autoExportActive) {
        const autoOptions = {
            ...lastExportSettings,
            mode: 'auto'
        };
        vscode.postMessage({
            type: 'export',
            options: autoOptions
        });

        vscode.postMessage({
            type: 'showInfo',
            message: 'Auto-export started. File will export automatically on save.'
        });
    } else {
        autoExportActive = false;
        window.autoExportActive = false;
        autoExportBrowserMode = false;
        lastExportSettings = null;
        window.lastExportSettings = null;

        // Update processes menu status
        updateAutoExportButton();

        vscode.postMessage({
            type: 'stopAutoExport'
        });

        vscode.postMessage({
            type: 'showInfo',
            message: 'Auto-export and Marp processes stopped.'
        });
    }
}

/**
 * Update auto-export button appearance and processes menu status
 */
function updateAutoExportButton() {
    const btn = document.getElementById('auto-export-btn');
    const icon = document.getElementById('auto-export-icon');

    // Update old auto-export button if it exists (may be removed in favor of processes menu)
    if (btn && icon) {
        if (!lastExportSettings) {
            btn.style.display = 'none';
            btn.classList.remove('active');
            icon.textContent = '▶';
            btn.title = 'Start auto-export with last settings';
        } else {
            btn.style.display = '';
            if (autoExportActive) {
                btn.classList.add('active');
                icon.textContent = '■';
                btn.title = 'Stop auto-export';
            } else {
                btn.classList.remove('active');
                icon.textContent = '▶';
                btn.title = 'Start auto-export with last settings';
            }
        }
    }

    // Update processes menu Marp status
    const marpStatus = document.getElementById('marp-export-status');
    const marpActions = document.getElementById('marp-export-actions');

    if (marpStatus) {
        if (autoExportActive) {
            marpStatus.textContent = 'Active';
            marpStatus.className = 'processes-status-value scanning';
            if (marpActions) marpActions.style.display = '';
        } else {
            marpStatus.textContent = 'Inactive';
            marpStatus.className = 'processes-status-value';
            if (marpActions) marpActions.style.display = 'none';
        }
    }

    // Update processes indicator
    if (typeof window.updateProcessesIndicator === 'function') {
        window.updateProcessesIndicator(autoExportActive);
    }
}

/**
 * Execute export with current settings
 */
function executeQuickExport() {
    if (!lastExportSettings) {
        vscode.postMessage({
            type: 'showInfo',
            message: 'No previous export settings found. Please use Export dialog first.'
        });
        showExportDialog();
        return;
    }

    vscode.postMessage({
        type: 'export',
        options: lastExportSettings
    });

    if (!autoExportActive) {
        vscode.postMessage({
            type: 'showInfo',
            message: 'Updating export...'
        });
    }
}

// =============================================================================
// COLUMN EXPORT
// =============================================================================

/**
 * Export a single column
 */
function exportColumn(columnId) {
    if (typeof closeAllMenus === 'function') {
        closeAllMenus();
    }

    if (!window.cachedBoard || !window.cachedBoard.columns) {
        vscode.postMessage({
            type: 'showError',
            message: 'No board data available'
        });
        return;
    }

    const columnIndex = window.cachedBoard.columns.findIndex(c => c.id === columnId);
    const column = window.cachedBoard.columns[columnIndex];

    if (!column) {
        vscode.postMessage({
            type: 'showError',
            message: 'Column not found'
        });
        return;
    }

    showExportDialogWithSelection('column', columnIndex, columnId);
}

// =============================================================================
// INCLUDE CLICK HANDLERS
// =============================================================================

/**
 * Handle clicks on column include filename links
 */
function handleColumnIncludeClick(event, filePath) {
    if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();

        vscode.postMessage({
            type: 'openIncludeFile',
            filePath: filePath
        });
    }
}

/**
 * Handle clicks on task include filename links
 */
function handleTaskIncludeClick(event, filePath) {
    if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();

        vscode.postMessage({
            type: 'openIncludeFile',
            filePath: filePath
        });
    }
}

/**
 * Handle clicks on regular include filename links
 */
function handleRegularIncludeClick(event, filePath) {
    if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();

        vscode.postMessage({
            type: 'openIncludeFile',
            filePath: filePath
        });
    }
}

/**
 * Handle column export result
 */
function handleColumnExportResult(result) {
    if (result.success) {
        vscode.postMessage({
            type: 'showInfo',
            message: result.message
        });

        if (result.exportedPath) {
            vscode.postMessage({
                type: 'askOpenExportFolder',
                path: result.exportedPath
            });
        }
    } else {
        vscode.postMessage({
            type: 'showError',
            message: result.message
        });
    }
}

/**
 * Handle copy content result from unified export
 */
function handleCopyContentResult(result) {
    if (result.success && result.content) {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(result.content).then(() => {
                // Update clipboard card source to reflect new content
                if (typeof refreshClipboardUI === 'function') {
                    setTimeout(() => refreshClipboardUI(true), 50);
                }
            }).catch(err => {
                console.error('[kanban.exportMarpUI.handleCopyContentResult] Failed to copy:', err);
                vscode.postMessage({
                    type: 'showError',
                    message: 'Failed to copy to clipboard'
                });
            });
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = result.content;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                // Update clipboard card source to reflect new content
                if (typeof refreshClipboardUI === 'function') {
                    setTimeout(() => refreshClipboardUI(true), 50);
                }
            } catch (err) {
                console.error('[kanban.exportMarpUI.handleCopyContentResult] Fallback copy failed:', err);
                vscode.postMessage({
                    type: 'showError',
                    message: 'Failed to copy to clipboard'
                });
            }
            document.body.removeChild(textarea);
        }
    } else {
        vscode.postMessage({
            type: 'showError',
            message: result.message || 'Failed to generate copy content'
        });
    }
}

// =============================================================================
// MARP GLOBAL SETTINGS MENU
// =============================================================================

/**
 * Toggle the Marp global settings burger menu
 */
function toggleMarpGlobalMenu(event, button) {
    event.stopPropagation();
    const menu = button.parentElement;
    const dropdown = menu.querySelector('.marp-global-menu-dropdown');
    const isActive = menu.classList.contains('active');

    document.querySelectorAll('.marp-global-menu.active').forEach(m => {
        if (m !== menu) m.classList.remove('active');
    });

    if (isActive) {
        menu.classList.remove('active');
    } else {
        const rect = button.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 2) + 'px';
        dropdown.style.left = rect.left + 'px';

        populateMarpGlobalMenu();
        menu.classList.add('active');
    }
}

/**
 * Populate the Marp global settings menu with current values
 */
function populateMarpGlobalMenu() {
    const content = document.getElementById('marp-global-settings-content');
    if (!content) return;

    const frontmatter = window.cachedBoard?.frontmatter || {};

    let html = '<div style="padding: 8px; max-width: 400px; min-width: 300px;">';

    // Marp Enable Toggle
    const marpEnabled = frontmatter.marp === 'true' || frontmatter.marp === true;
    html += '<div style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">';
    html += '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer; flex: 1;">';
    html += `<input type="checkbox" ${marpEnabled ? 'checked' : ''} onchange="updateMarpGlobalSetting('marp', this.checked ? 'true' : 'false')" style="cursor: pointer;">`;
    html += '<span style="font-weight: bold; color: #ddd;">Enable Marp</span>';
    html += '</label>';
    html += '</div>';
    html += '<div class="marp-global-menu-divider"></div>';

    // Presentation Settings
    html += '<div style="margin-bottom: 8px; font-weight: bold; color: #888; font-size: 11px; text-transform: uppercase;">Presentation</div>';

    html += createMarpInputField('theme', '🎨 Theme', frontmatter.theme, 'e.g., default, gaia, uncover');
    html += createMarpInputField('style', '✏️ Style', frontmatter.style, 'Custom CSS styles');
    html += createMarpInputField('size', '📐 Size', frontmatter.size, 'e.g., 16:9, 4:3, 1920x1080');
    html += createMarpInputField('headingDivider', '📑 Heading Divider', frontmatter.headingDivider, 'true/false or 1-6');
    html += createMarpInputField('math', '∑ Math', frontmatter.math, 'mathjax or katex');

    html += '<div class="marp-global-menu-divider"></div>';

    // Metadata
    html += '<div style="margin-bottom: 8px; font-weight: bold; color: #888; font-size: 11px; text-transform: uppercase;">Metadata</div>';

    html += createMarpInputField('title', '📝 Title', frontmatter.title);
    html += createMarpInputField('author', '👤 Author', frontmatter.author);
    html += createMarpInputField('description', '📄 Description', frontmatter.description);
    html += createMarpInputField('keywords', '🔑 Keywords', frontmatter.keywords);
    html += createMarpInputField('url', '🔗 URL', frontmatter.url);
    html += createMarpInputField('image', '🖼 Image', frontmatter.image);

    html += '<div class="marp-global-menu-divider"></div>';

    // Slide Settings
    html += '<div style="margin-bottom: 8px; font-weight: bold; color: #888; font-size: 11px; text-transform: uppercase;">Slide Settings</div>';

    html += createMarpInputField('paginate', '📄 Paginate', frontmatter.paginate, 'true/false');
    html += createMarpInputField('header', '⬆️ Header', frontmatter.header);
    html += createMarpInputField('footer', '⬇️ Footer', frontmatter.footer);

    html += '<div class="marp-global-menu-divider"></div>';

    // Styling
    html += '<div style="margin-bottom: 8px; font-weight: bold; color: #888; font-size: 11px; text-transform: uppercase;">Styling</div>';

    html += createMarpInputField('class', '🏷 Class', frontmatter.class);
    html += createMarpInputField('color', '🎨 Color', frontmatter.color);
    html += createMarpInputField('backgroundColor', '🎨 Background Color', frontmatter.backgroundColor);
    html += createMarpInputField('backgroundImage', '🖼 Background Image', frontmatter.backgroundImage, 'URL');
    html += createMarpInputField('backgroundPosition', '📍 BG Position', frontmatter.backgroundPosition);
    html += createMarpInputField('backgroundRepeat', '🔄 BG Repeat', frontmatter.backgroundRepeat);
    html += createMarpInputField('backgroundSize', '📏 BG Size', frontmatter.backgroundSize);

    html += '<div class="marp-global-menu-divider"></div>';

    // Marp Classes Section
    const availableClasses = window.marpAvailableClasses || [];
    const activeClasses = getMarpClassesForElement('global', null, null);

    html += '<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-direction: column;">';
    html += '<div style="font-weight: bold; color: #888; font-size: 11px; text-transform: uppercase; white-space: nowrap; flex-direction: column; align-items: flex-start; align-self: baseline; width: 120px;">Marp Classes</div>';

    html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; flex: 1;">';
    availableClasses.forEach(className => {
        const isActive = activeClasses.includes(className);
        const checkmark = isActive ? '✓ ' : '';
        html += `
            <button class="marp-class-chip ${isActive ? 'active' : ''}"
                    onclick="toggleMarpClass('global', null, null, '${className}'); event.stopPropagation();"
                    style="padding: 6px 8px; font-size: 11px; border: 1px solid #555; border-radius: 4px; background: ${isActive ? '#4a90e2' : 'var(--board-background)'}; color: var(--vscode-foreground); cursor: pointer; text-align: left; transition: all 0.2s;">
                ${checkmark}${className}
            </button>
        `;
    });
    html += '</div>';
    html += '</div>';

    html += '<div class="marp-global-menu-divider"></div>';

    // YAML Preview Section
    html += '<div style="margin-bottom: 8px; font-weight: bold; color: #888; font-size: 11px; text-transform: uppercase;">Current YAML Frontmatter</div>';

    const yamlContent = window.cachedBoard?.yamlHeader || '';
    let displayYaml = yamlContent;
    if (displayYaml) {
        const lines = displayYaml.split('\n').filter(line => line.trim() !== '---');
        displayYaml = lines.join('\n').trim();
    }
    displayYaml = displayYaml || '(No YAML frontmatter found)';

    html += '<div style="margin-bottom: 10px;">';
    html += '<pre style="background: #1e1e1e; border: 1px solid #555; padding: 8px; border-radius: 4px; font-size: 11px; color: #d4d4d4; overflow-x: auto; margin: 0; white-space: pre-wrap; word-wrap: break-word; max-height: 200px; overflow-y: auto;">';
    html += escapeHtmlForMarp(displayYaml);
    html += '</pre>';
    html += '</div>';

    html += '</div>';

    content.innerHTML = html;
}

/**
 * Create an input field for a Marp setting
 */
function createMarpInputField(key, label, value, placeholder) {
    value = value || '';
    placeholder = placeholder || '';

    let html = '<div style="margin-bottom: 4px; display: flex; align-items: baseline;">';
    html += `<div style="font-size: 12px; margin-bottom: 4px; color: #ccc; width: 180px;">${label}</div>`;
    html += `<input type="text" value="${escapeHtmlForMarp(value)}" placeholder="${placeholder}"
                    data-marp-key="${escapeHtmlForMarp(key)}"
                    data-original-value="${escapeHtmlForMarp(value)}"
                    onkeypress="if(event.key==='Enter'){updateMarpGlobalSetting(this.dataset.marpKey, this.value);}"
                    onblur="if(this.value !== this.dataset.originalValue){updateMarpGlobalSetting(this.dataset.marpKey, this.value); this.dataset.originalValue = this.value;}"
                    style="width: 100%; padding: 4px; background: var(--board-background); border: 1px solid #555; color: var(--vscode-foreground); border-radius: 4px; font-size: 12px; box-sizing: border-box;">`;
    html += '</div>';

    return html;
}

/**
 * Escape HTML for use in attributes (local to this module)
 */
function escapeHtmlForMarp(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;');
}

/**
 * Update a single Marp global setting in the YAML frontmatter
 */
function updateMarpGlobalSetting(key, value) {
    vscode.postMessage({
        type: "updateMarpGlobalSetting",
        key: key,
        value: value
    });

    if (!window.cachedBoard.frontmatter) {
        window.cachedBoard.frontmatter = {};
    }
    if (value === '' || value === null || value === undefined) {
        delete window.cachedBoard.frontmatter[key];
    } else {
        window.cachedBoard.frontmatter[key] = value;
    }

    updateYamlHeaderString(key, value);
    refreshYamlPreview();
}

/**
 * Update the yamlHeader string with a new key-value pair
 */
function updateYamlHeaderString(key, value) {
    if (!window.cachedBoard) return;

    let yamlHeader = window.cachedBoard.yamlHeader || '';
    const lines = yamlHeader.split('\n');

    let keyFound = false;
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (match && match[1] === key) {
            if (value === '' || value === null || value === undefined) {
                lines.splice(i, 1);
            } else {
                lines[i] = `${key}: ${value}`;
            }
            keyFound = true;
            break;
        }
    }

    if (!keyFound && value !== '' && value !== null && value !== undefined) {
        if (yamlHeader === '') {
            lines.push('kanban-plugin: board');
            lines.push(`${key}: ${value}`);
        } else {
            lines.push(`${key}: ${value}`);
        }
    }

    window.cachedBoard.yamlHeader = lines.filter(line => line.trim() !== '').join('\n');
}

/**
 * Refresh just the YAML preview section
 */
function refreshYamlPreview() {
    const yamlContent = window.cachedBoard?.yamlHeader || '';
    let displayYaml = yamlContent;
    if (displayYaml) {
        const lines = displayYaml.split('\n').filter(line => line.trim() !== '---');
        displayYaml = lines.join('\n').trim();
    }
    displayYaml = displayYaml || '(No YAML frontmatter found)';

    const preElement = document.querySelector('#marp-global-settings-content pre');
    if (preElement) {
        preElement.textContent = displayYaml;
    }
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

// Close Marp dropdown when clicking outside
document.addEventListener("click", function(event) {
    const menus = document.querySelectorAll('.marp-global-menu');
    menus.forEach(menu => {
        if (!menu.contains(event.target)) {
            menu.classList.remove('active');
        }
    });
});

// =============================================================================
// GLOBAL EXPORTS
// =============================================================================

// Export functions
window.filterTagsForExport = filterTagsForExport;
window.showExportDialog = showExportDialog;
window.showExportDialogWithSelection = showExportDialogWithSelection;
window.closeExportModal = closeExportModal;
window.setExportDefaultFolder = setExportDefaultFolder;
window.selectExportFolder = selectExportFolder;
window.setSelectedExportFolder = setSelectedExportFolder;
window.initializeExportTree = initializeExportTree;
window.updateLinkHandlingOptionsVisibility = updateLinkHandlingOptionsVisibility;
window.executeUnifiedExport = executeUnifiedExport;
window.handleExportResult = handleExportResult;
window.getWorkspacePath = getWorkspacePath;
window.handleFormatChange = handleFormatChange;
window.handleUseMarpChange = handleUseMarpChange;
window.handleMarpOutputFormatChange = handleMarpOutputFormatChange;
window.handleMarpHandoutChange = handleMarpHandoutChange;
window.handleMarpHandoutPresetChange = handleMarpHandoutPresetChange;
window.applyExportPreset = applyExportPreset;
window.applyPresetMarpPresentation = applyPresetMarpPresentation;
window.applyPresetMarpPdf = applyPresetMarpPdf;
window.applyPresetShareContent = applyPresetShareContent;
window.saveLastExportSettings = saveLastExportSettings;
window.resetPresetToCustom = resetPresetToCustom;
window.addExportSettingChangeListeners = addExportSettingChangeListeners;
window.generateExportFolderName = generateExportFolderName;
window.updateExportFolderName = updateExportFolderName;

// Marp functions
window.checkMarpStatus = checkMarpStatus;
window.handleMarpStatus = handleMarpStatus;
window.handleMarpAvailableClasses = handleMarpAvailableClasses;
window.handleMarpThemesAvailable = handleMarpThemesAvailable;
window.loadMarpThemes = loadMarpThemes;
window.getMarpClassesForElement = getMarpClassesForElement;
window.isMarpDirectiveActive = isMarpDirectiveActive;
window.setMarpDirective = setMarpDirective;
window.toggleMarpDirective = toggleMarpDirective;
window.refreshMarpDirectivesSubmenu = refreshMarpDirectivesSubmenu;
window.toggleMarpClass = toggleMarpClass;

// Pandoc functions
window.checkPandocStatus = checkPandocStatus;
window.handlePandocStatus = handlePandocStatus;
window.handleUsePandocChange = handleUsePandocChange;

// Auto-export functions
window.toggleAutoExport = toggleAutoExport;
window.updateAutoExportButton = updateAutoExportButton;
window.executeQuickExport = executeQuickExport;
window.exportColumn = exportColumn;

// Include click handlers
window.handleColumnIncludeClick = handleColumnIncludeClick;
window.handleTaskIncludeClick = handleTaskIncludeClick;
window.handleRegularIncludeClick = handleRegularIncludeClick;
window.handleColumnExportResult = handleColumnExportResult;
window.handleCopyContentResult = handleCopyContentResult;

// Marp global settings
window.toggleMarpGlobalMenu = toggleMarpGlobalMenu;
window.populateMarpGlobalMenu = populateMarpGlobalMenu;
window.createMarpInputField = createMarpInputField;
window.updateMarpGlobalSetting = updateMarpGlobalSetting;
window.updateYamlHeaderString = updateYamlHeaderString;
window.refreshYamlPreview = refreshYamlPreview;

// State variables (for external access)
window.lastExportSettings = lastExportSettings;
window.autoExportActive = autoExportActive;
