/**
 * Main entry point for frontend bundle
 * This file imports all modules in dependency order
 *
 * During migration, modules still use window.* for cross-module communication.
 * After bundling, these will be converted to proper ES module imports.
 */

// Utility modules (order matters - later modules may depend on earlier ones)
import './utils/viewLogger.js';
import './utils/colorUtils.js';
import './utils/fileTypeUtils.js';
import './utils/tagUtils.js';
import './utils/configManager.js';
import './utils/styleManager.js';
// menuManager.js removed - was dead code (overwritten by SimpleMenuManager in menuOperations.js)
import './utils/dragStateManager.js';
import './utils/validationUtils.js';
import './utils/modalUtils.js';
import './utils/activityIndicator.js';
import './utils/exportTreeBuilder.js';
import './utils/exportTreeUI.js';
import './utils/smartLogger.js';
import './utils/menuUtils.js';

// Core modules
import './markdownRenderer.js';
import './taskEditor.js';
import './boardRenderer.js';
import './dragDrop.js';
import './menuOperations.js';
import './debugOverlay.js';
import './clipboardHandler.js';
import './navigationHandler.js';
import './foldingStateManager.js';
import './templateDialog.js';
import './exportMarpUI.js';
import './webview.js';
