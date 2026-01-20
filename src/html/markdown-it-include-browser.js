// Browser-compatible markdown-it-include plugin
// Processes !!!include(filepath)!!! statements by requesting file content from VS Code

(function(global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() :
  typeof define === "function" && define.amd ? define(factory) :
  (global = typeof globalThis !== "undefined" ? globalThis : global || self,
  global.markdownItInclude = factory());
})(this, (function() {
  "use strict";

  const log = (...args) => {
    if (typeof globalThis !== 'undefined' && globalThis.kanbanDebug?.enabled) {
      console.log('[include-browser]', ...args);
    }
  };

  const INCLUDE_RE = /!!!include\(([^)]+)\)!!!/;

  // Cache for file contents to avoid repeated requests
  const fileCache = new Map();
  const pendingRequests = new Set();

  // Helper function to detect if path is absolute
  function isAbsolutePath(filePath) {
    return filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);
  }

  // Helper to keep include labels consistent across all render paths
  function formatIncludeLabel(fileName, suffix = '') {
    return `!(${fileName})!${suffix ? ` ${suffix}` : ''}`;
  }

  // Helper function to generate include link with burger menu (matching generateIncludeLinkWithMenu in tagUtils.js)
  function generateIncludeLinkWithMenu(filePath, displayText, clickHandler, isBroken = false) {
    const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    const handlerFn = clickHandler === 'task' ? 'handleTaskIncludeClick' :
                      clickHandler === 'column' ? 'handleColumnIncludeClick' : 'handleRegularIncludeClick';
    const isAbsolute = isAbsolutePath(filePath);
    const isColumnTitle = clickHandler === 'column' ? 'true' : 'false';

    // Add include-broken class when file is not found
    const brokenClass = isBroken ? ' include-broken' : '';

    // Show error tooltip on hover for broken includes
    const linkTooltip = isBroken
        ? `Include file not found: ${escapeHtml(filePath)}`
        : `Alt+click to open file: ${escapeHtml(filePath)}`;
    const menuTooltip = isBroken
        ? `Include file not found - click for options`
        : `Path options`;

    return `<span class="include-path-overlay-container${brokenClass}" data-include-path="${escapeHtml(filePath)}" data-include-type="${clickHandler}"${isBroken ? ` data-include-error="true"` : ''}>
        <span class="include-filename-link" data-file-path="${escapeHtml(filePath)}" onclick="${handlerFn}(event, '${escapeHtml(filePath)}')" title="${linkTooltip}">${escapeHtml(displayText)}</span>
        <button class="include-menu-btn" onclick="event.stopPropagation(); toggleIncludePathMenu(this.parentElement, '${escapedPath}')" title="${menuTooltip}">☰</button>
        <div class="include-path-menu">
            <button class="include-path-menu-item" onclick="event.stopPropagation(); openPath(this, '${escapedPath}')">📄 Open</button>
            <button class="include-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
            <button class="include-path-menu-item" onclick="event.stopPropagation(); searchForIncludeFile(this, '${escapedPath}', '${isColumnTitle}')">🔎 Search for File</button>
            <div class="include-path-menu-divider"></div>
            <button class="include-path-menu-item${isAbsolute ? '' : ' disabled'}" ${isAbsolute ? `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'relative', true)"` : 'disabled'}>📁 Convert to Relative</button>
            <button class="include-path-menu-item${isAbsolute ? ' disabled' : ''}" ${isAbsolute ? 'disabled' : `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'absolute', true)"`}>📂 Convert to Absolute</button>
            <div class="include-path-menu-divider"></div>
            <button class="include-path-menu-item" onclick="event.stopPropagation(); deleteFromMarkdown('${escapedPath}')">🗑️ Delete</button>
        </div>
    </span>`;
  }

  // Image file extensions (lowercase, without dot)
  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif', 'avif', 'heic', 'heif'];
  const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v', '3gp', 'ogv', 'mpg', 'mpeg'];

  /**
   * Get file extension from a path (lowercase, without dot)
   */
  function getFileExtension(filePath) {
    if (!filePath) return '';
    const ext = filePath.split('.').pop();
    return ext ? ext.toLowerCase() : '';
  }

  /**
   * Check if file path is an image file
   */
  function isImageFile(filePath) {
    return IMAGE_EXTENSIONS.includes(getFileExtension(filePath));
  }

  /**
   * Check if file path is a video file
   */
  function isVideoFile(filePath) {
    return VIDEO_EXTENSIONS.includes(getFileExtension(filePath));
  }

  /**
   * Generate HTML for an image include (with path menu overlay)
   * @param {string} filePath - Path to the image
   * @param {boolean} isBroken - Whether the image failed to load
   * @returns {string} HTML string
   */
  function generateImageIncludeHtml(filePath, isBroken) {
    const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    const isAbsolute = isAbsolutePath(filePath);
    const brokenClass = isBroken ? ' image-broken' : '';

    return `<span class="image-path-overlay-container${brokenClass}" data-image-path="${escapeHtml(filePath)}">
      <img src="${escapeHtml(filePath)}" alt="include: ${escapeHtml(filePath)}"
           onerror="handleMediaNotFound(this, '${escapedPath}', 'image')"
           style="max-width: 100%; height: auto;">
      <button class="image-menu-btn" onclick="event.stopPropagation(); toggleImagePathMenu(this.parentElement, '${escapedPath}')" title="Path options">☰</button>
    </span>`;
  }

  /**
   * Generate HTML for a video include (with path menu overlay)
   * @param {string} filePath - Path to the video
   * @param {boolean} isBroken - Whether the video failed to load
   * @returns {string} HTML string
   */
  function generateVideoIncludeHtml(filePath, isBroken) {
    const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    const brokenClass = isBroken ? ' video-broken' : '';

    return `<span class="video-path-overlay-container${brokenClass}" data-video-path="${escapeHtml(filePath)}">
      <video src="${escapeHtml(filePath)}" controls
             onerror="handleMediaNotFound(this, '${escapedPath}', 'video')"
             style="max-width: 100%; height: auto;">
        Your browser does not support the video tag.
      </video>
      <button class="video-menu-btn" onclick="event.stopPropagation(); toggleVideoPathMenu(this.parentElement, '${escapedPath}')" title="Path options">☰</button>
    </span>`;
  }

  /**
   * Generate HTML for a broken include (file not found)
   * @param {string} filePath - Path to the include file
   * @returns {string} HTML string
   */
  function generateBrokenIncludeHtml(filePath) {
    const fileName = filePath.split('/').pop() || filePath;
    const displayText = formatIncludeLabel(fileName);
    const includeLink = generateIncludeLinkWithMenu(filePath, displayText, 'regular', true);

    return `<div class="include-container include-error" data-include-file="${escapeHtml(filePath)}">
      <div class="include-title-bar">
        ${includeLink}
      </div>
      <div class="include-content-area">
        <div class="broken-include-placeholder">Include file not found</div>
      </div>
    </div>`;
  }

  /**
   * Generate HTML for a successfully loaded include container
   * @param {string} filePath - Path to the include file
   * @param {string} includeDir - Directory of the include file
   * @param {string} renderedContent - The rendered markdown content
   * @returns {string} HTML string
   */
  function generateIncludeContainerHtml(filePath, includeDir, renderedContent) {
    const fileName = filePath.split('/').pop() || filePath;
    const displayText = formatIncludeLabel(fileName);
    const includeLink = generateIncludeLinkWithMenu(filePath, displayText, 'regular');

    return `<div class="include-container" data-include-file="${escapeHtml(filePath)}" data-include-dir="${escapeHtml(includeDir)}">
      <div class="include-title-bar">
        ${includeLink}
      </div>
      <div class="include-content-area">
        ${renderedContent}
      </div>
    </div>`;
  }

  function markdownItInclude(md, options = {}) {
    const defaultOptions = {
      root: '',
      includeRe: INCLUDE_RE
    };

    options = { ...defaultOptions, ...options };

    // Block-level rule for include processing (handles includes on their own line)
    md.block.ruler.before('paragraph', 'include_block', function(state, startLine, endLine, silent) {
      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const lineText = state.src.slice(pos, max).trim();

      // Check if this line is ONLY an include statement
      const match = lineText.match(options.includeRe);
      if (!match || match.index !== 0 || match[0] !== lineText) {
        return false;
      }

      if (silent) { return true; }

      const filePath = match[1].trim();
      let content = getFileContent(filePath);

      const token = state.push('include_block', 'div', 0);
      token.content = content;
      token.filePath = filePath;
      token.map = [startLine, startLine + 1];

      state.line = startLine + 1;
      return true;
    });

    // Inline rule for include processing (handles includes within text)
    md.inline.ruler.before('text', 'include_inline', function(state, silent) {
      const start = state.pos;

      // Look for include pattern using match() to avoid regex state issues
      const srcSlice = state.src.slice(start);
      const match = srcSlice.match(options.includeRe);
      if (!match || match.index !== 0) {
        return false;
      }

      // IMPORTANT: When returning true, state.pos MUST always be incremented
      // This applies to BOTH silent and non-silent modes!
      // Failing to do this causes "inline rule didn't increment state.pos" errors
      state.pos = start + match[0].length;

      // In silent mode, we've matched and advanced pos - just return true
      if (silent) {
        return true;
      }

      const filePath = match[1].trim();

      // Try to get file content
      let content = getFileContent(filePath);

      if (content === null) {
        // File not cached yet - show placeholder and request content
        const token = state.push('include_placeholder', 'span', 0);
        token.content = filePath;
        token.attrSet('class', 'include-placeholder');
        token.attrSet('title', `Loading include file: ${filePath}`);
      } else {
        // Successfully got content - render it inline as markdown
        const token = state.push('include_content', 'span', 0);
        token.content = content;
        token.attrSet('class', 'included-content-inline');
        token.attrSet('data-include-file', filePath);
      }

      return true;
    });

    // Renderer for block-level include content
    md.renderer.rules.include_block = function(tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      const content = token.content;
      const filePath = token.filePath || '';

      // Check if include is an image file - render as image element
      if (isImageFile(filePath)) {
        // content === null means file not found (broken image)
        return generateImageIncludeHtml(filePath, content === null);
      }

      // Check if include is a video file - render as video element
      if (isVideoFile(filePath)) {
        // content === null means file not found (broken video)
        return generateVideoIncludeHtml(filePath, content === null);
      }

      // Check if this is a broken include (file not found)
      const isBrokenInclude = brokenIncludeCache.has(filePath);

      // If content is null and marked as broken, show error state
      if (content === null && isBrokenInclude) {
        return generateBrokenIncludeHtml(filePath);
      }

      // If content is null (not loaded yet), show placeholder with data attribute for targeted update
      if (content === null) {
        return `<div class="include-placeholder-block" data-include-file="${escapeHtml(filePath)}" data-include-pending="true" title="Loading include file: ${escapeHtml(filePath)}">` +
               `📄⏳ Loading: ${escapeHtml(filePath)}` +
               `</div>`;
      }

      // Set include context so relative paths in included content resolve correctly
      const includeDir = filePath.substring(0, filePath.lastIndexOf('/')) || filePath.substring(0, filePath.lastIndexOf('\\'));
      const previousContext = window.currentTaskIncludeContext;
      window.currentTaskIncludeContext = { includeDir };

      // Render the content as markdown
      try {
        const rendered = md.render(content);
        return generateIncludeContainerHtml(filePath, includeDir, rendered);
      } catch (error) {
        console.error('[include-block] Error rendering included content from file:', filePath);
        console.error('[include-block] Content length:', content ? content.length : 0);
        console.error('[include-block] Error:', error);

        // Try to find the problematic lines using binary search
        const errorLocation = findErrorLocation(md, content);
        if (errorLocation) {
          console.error('[include-block] Found ' + errorLocation.lines.length + ' problematic line(s):');
          console.error('[include-block]\n' + errorLocation.summary);
        }

        // Return the raw content escaped as fallback
        const fileName = filePath.split('/').pop() || filePath;
        const displayText = formatIncludeLabel(fileName, '- PARSE ERROR');
        const includeLink = generateIncludeLinkWithMenu(filePath, displayText, 'regular', true);

        const errorLinesHtml = errorLocation ? errorLocation.lines.map(l =>
          `<div style="margin: 4px 0;"><strong>Line ${l.lineNumber}:</strong> <span style="font-family: monospace; background: #5a1d1d !important; color: #fff !important; padding: 2px 6px; border-radius: 3px;">${escapeHtml(l.content)}</span></div>`
        ).join('') : '';

        const suspectLinesHtml = (errorLocation && errorLocation.suspectLines && errorLocation.suspectLines.length > 0)
          ? errorLocation.suspectLines.map(l =>
            `<div style="margin: 4px 0;"><strong>Line ${l.lineNumber}:</strong> <span style="font-family: monospace; background: #4a3d1d !important; color: #fff !important; padding: 2px 6px; border-radius: 3px;">${escapeHtml(l.content)}</span></div>`
          ).join('')
          : '';

        return `<div class="include-container include-error" data-include-file="${escapeHtml(filePath)}">
          <div class="include-title-bar">
            ${includeLink}
          </div>
          <div class="include-content-area">
            ${errorLocation ? `<div class="include-error-info" style="border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); border-radius: 4px; padding: 8px; margin-bottom: 12px;">
              <strong style="color: var(--vscode-errorForeground, #f48771);">⚠ Error triggers at:</strong>
              ${errorLinesHtml}
              ${suspectLinesHtml ? `<div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #555;">
                <strong style="color: #e0a030;">⚠ Possible cause (unclosed brackets):</strong>
                ${suspectLinesHtml}
              </div>` : ''}
            </div>` : ''}
            <pre style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(content || '')}</pre>
          </div>
        </div>`;
      } finally {
        // Always restore previous context (for nested includes)
        window.currentTaskIncludeContext = previousContext;
      }
    };

    // Renderer for inline include content
    md.renderer.rules.include_content = function(tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      const content = token.content;
      const filePath = token.attrGet('data-include-file') || '';

      // Check if include is an image file - render as image element
      if (isImageFile(filePath)) {
        // For inline, content is available, so image exists
        return generateImageIncludeHtml(filePath, false);
      }

      // Check if include is a video file - render as video element
      if (isVideoFile(filePath)) {
        // For inline, content is available, so video exists
        return generateVideoIncludeHtml(filePath, false);
      }

      // Set include context so relative paths in included content resolve correctly
      const includeDir = filePath.substring(0, filePath.lastIndexOf('/')) || filePath.substring(0, filePath.lastIndexOf('\\'));
      const previousContext = window.currentTaskIncludeContext;
      window.currentTaskIncludeContext = { includeDir };

      // Render the content as markdown
      try {
        const rendered = md.render(content);

        // Create filename display (show just the basename) with burger menu
        const fileName = filePath.split('/').pop() || filePath;
        const displayText = formatIncludeLabel(fileName);
        return generateIncludeContainerHtml(filePath, includeDir, rendered);
      } catch (error) {
        console.error('Error rendering included content:', error);
        return `<span class="include-error" title="Error rendering included content">Error including: ${escapeHtml(filePath)}</span>`;
      } finally {
        // Always restore previous context (for nested includes)
        window.currentTaskIncludeContext = previousContext;
      }
    };

    // Renderer for include placeholders (inline) - shown while loading or broken
    md.renderer.rules.include_placeholder = function(tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      const filePath = token.content;
      log('[include_placeholder renderer] filePath:', filePath, 'brokenIncludeCache.has:', brokenIncludeCache.has(filePath));

      // Check if include is an image file - render as image element (will show broken if fails)
      if (isImageFile(filePath)) {
        return generateImageIncludeHtml(filePath, brokenIncludeCache.has(filePath));
      }

      // Check if include is a video file - render as video element (will show broken if fails)
      if (isVideoFile(filePath)) {
        return generateVideoIncludeHtml(filePath, brokenIncludeCache.has(filePath));
      }

      // Check if this is a broken include (file not found)
      const isBrokenInclude = brokenIncludeCache.has(filePath);
      log('[include_placeholder renderer] isBrokenInclude:', isBrokenInclude);
      if (isBrokenInclude) {
        return generateBrokenIncludeHtml(filePath);
      }

      return `<span class="include-placeholder" data-include-file="${escapeHtml(filePath)}" data-include-pending="true" title="Loading include file: ${escapeHtml(filePath)}">` +
             `📄⏳ Loading: ${escapeHtml(filePath)}` +
             `</span>`;
    };
  }

  // Function to get file content (communicates with VS Code extension)
  function getFileContent(filePath) {
    // Check cache first
    if (fileCache.has(filePath)) {
      return fileCache.get(filePath);
    }

    // If not already requesting, request it
    if (!pendingRequests.has(filePath) && typeof vscode !== 'undefined') {
      pendingRequests.add(filePath);

      try {
        // Request file content from VS Code
        vscode.postMessage({
          type: 'requestIncludeFile',
          filePath: filePath
        });
      } catch (error) {
        console.error('[include-browser] Error requesting include file:', error);
        pendingRequests.delete(filePath);
      }
    }

    // Return null to indicate content is not available yet
    return null;
  }

  // Track if we've received includes for debouncing
  let includeRenderTimer = null;
  let pendingBoardUpdate = false; // Prevent infinite loop

  // Track broken includes (file not found)
  const brokenIncludeCache = new Map();

  // Function to update cache when file content is received
  function updateFileCache(filePath, content, error) {
    log('updateFileCache called for:', filePath, 'content length:', content?.length, 'error:', error);

    // Remove from pending requests
    pendingRequests.delete(filePath);

    // Track if this is a broken include (file not found)
    // CRITICAL: When error is set, force content to null so re-render creates include_placeholder token
    if (error || content === null) {
      brokenIncludeCache.set(filePath, error || 'File not found');
      content = null;  // Force null so getFileContent returns null on re-render
      log('Marked as broken include:', filePath);
    } else {
      brokenIncludeCache.delete(filePath);
    }

    // Check if content was previously cached
    const oldContent = fileCache.get(filePath);
    const wasNotCached = oldContent === undefined || oldContent === null;
    const contentChanged = oldContent !== content;
    log('wasNotCached:', wasNotCached, 'contentChanged:', contentChanged);

    // Update cache (content is null for broken includes)
    fileCache.set(filePath, content);

    // Register this inline include in the backend's unified system for conflict resolution
    if (typeof vscode !== 'undefined') {
      try {
        vscode.postMessage({
          type: 'registerInlineInclude',
          filePath: filePath,
          content: content
        });
      } catch (error) {
        console.error('[include-browser] Error registering inline include:', error);
      }
    }

    // Trigger re-render if content is new OR has changed
    // This is critical for error handling: first call may have empty content (no error),
    // second call may have error flag - we need to re-render when error arrives
    if (wasNotCached || contentChanged) {
      log('Content new or changed, calling updatePendingIncludePlaceholders');
      updatePendingIncludePlaceholders(filePath);
    }
  }

  // Function to update only the task descriptions that have pending include placeholders
  function updatePendingIncludePlaceholders(filePath) {
    log('updatePendingIncludePlaceholders called for:', filePath);

    // Find all pending placeholders for this specific file
    const selector = `[data-include-pending="true"][data-include-file="${CSS.escape(filePath)}"]`;
    log('Looking for placeholders with selector:', selector);
    const placeholders = document.querySelectorAll(selector);
    log('Found', placeholders.length, 'placeholders');

    if (placeholders.length === 0) {
      // Debug: check if there are ANY include placeholders
      const allPlaceholders = document.querySelectorAll('[data-include-pending="true"]');
      log('Total pending placeholders in DOM:', allPlaceholders.length);
      if (allPlaceholders.length > 0) {
        log('Their file paths:', Array.from(allPlaceholders).map(p => p.getAttribute('data-include-file')));
      }
      return;
    }

    // Find unique task description containers that need re-rendering
    const taskDescriptionsToUpdate = new Set();

    placeholders.forEach(placeholder => {
      // Find the closest task-description-display ancestor
      const taskDescription = placeholder.closest('.task-description-display');
      log('Placeholder closest task-description-display:', taskDescription ? 'found' : 'NOT FOUND');
      if (taskDescription) {
        taskDescriptionsToUpdate.add(taskDescription);
      }
    });

    log('Task descriptions to update:', taskDescriptionsToUpdate.size);

    // Re-render each affected task description
    taskDescriptionsToUpdate.forEach(taskDescriptionEl => {
      // Find the task element (class is 'task-item', not 'task')
      const taskEl = taskDescriptionEl.closest('.task-item');
      if (!taskEl) {
        log('No .task-item parent found');
        return;
      }

      const taskId = taskEl.dataset.taskId;
      if (!taskId) {
        log('No taskId on task element');
        return;
      }
      log('Found taskId:', taskId);

      // Get the task data from the current board data (stored in window.cachedBoard)
      if (typeof window.cachedBoard === 'undefined' || !window.cachedBoard) {
        log('window.cachedBoard not available');
        return;
      }

      // Find the task in board data
      let taskData = null;
      for (const column of window.cachedBoard.columns || []) {
        const found = (column.tasks || []).find(t => t.id === taskId);
        if (found) {
          taskData = found;
          break;
        }
      }

      if (!taskData || !taskData.description) {
        log('Task data or description not found. taskData:', !!taskData, 'description:', !!taskData?.description);
        return;
      }
      log('Found task description:', taskData.description.substring(0, 100));

      // Re-render just the description using the existing renderMarkdown function
      if (typeof window.renderMarkdown === 'function') {
        log('Calling window.renderMarkdown');
        const renderedHtml = window.renderMarkdown(taskData.description);
        log('Rendered HTML length:', renderedHtml?.length);
        taskDescriptionEl.innerHTML = renderedHtml;
        log('Updated task description innerHTML');

        // Re-apply broken element markers after re-render
        // The markers were lost when innerHTML was replaced
        requestAnimationFrame(() => {
          if (typeof window.markBrokenElements === 'function' && window._cachedBrokenElements) {
            const broken = window._cachedBrokenElements;
            if (broken.link?.length > 0) {
              window.markBrokenElements(broken.link, 'link');
            }
            if (broken.image?.length > 0) {
              window.markBrokenElements(broken.image, 'image', window.handleMediaNotFound);
            }
            if (broken.video?.length > 0) {
              window.markBrokenElements(broken.video, 'video', window.handleMediaNotFound);
            }
          }
        });
      } else {
        log('window.renderMarkdown is NOT a function:', typeof window.renderMarkdown);
      }
    });
  }

  // Helper function to find error location using binary search
  function findErrorLocation(md, content) {
    if (!content) return null;

    const lines = content.split('\n');
    const totalLines = lines.length;

    // Binary search to find the problematic line range
    let low = 0;
    let high = totalLines;
    let lastFailingEnd = totalLines;

    // First, find approximately where the error occurs
    while (high - low > 10) {
      const mid = Math.floor((low + high) / 2);
      const testContent = lines.slice(0, mid).join('\n');

      try {
        md.render(testContent);
        // Success - error is in the second half
        low = mid;
      } catch (e) {
        // Failed - error is in the first half
        lastFailingEnd = mid;
        high = mid;
      }
    }

    // Find the first line that triggers the error
    let firstErrorLine = -1;
    for (let i = low; i < Math.min(lastFailingEnd + 1, totalLines); i++) {
      const testContent = lines.slice(0, i + 1).join('\n');
      try {
        md.render(testContent);
      } catch (e) {
        firstErrorLine = i;
        break;
      }
    }

    if (firstErrorLine === -1) return null;

    // Now look for unclosed brackets BEFORE the error line
    // The real cause is often an unclosed [ earlier in the file
    const suspectLines = [];
    let bracketBalance = 0;

    for (let i = 0; i < firstErrorLine; i++) {
      const line = lines[i];
      const openBrackets = (line.match(/(?<!\\)\[/g) || []).length;
      const closeBrackets = (line.match(/(?<!\\)\]/g) || []).length;
      const lineBalance = openBrackets - closeBrackets;

      if (lineBalance !== 0) {
        bracketBalance += lineBalance;
        if (lineBalance > 0) {
          // This line has unclosed brackets - potential cause
          suspectLines.push({
            lineNumber: i + 1,
            content: line,
            issue: `unclosed bracket (${openBrackets} open, ${closeBrackets} close)`
          });
        }
      }
    }

    // Build result with both the trigger line and suspect lines
    const result = {
      lines: [{
        lineNumber: firstErrorLine + 1,
        content: lines[firstErrorLine]
      }],
      suspectLines: suspectLines.slice(-5), // Last 5 suspect lines before error
      summary: `Line ${firstErrorLine + 1}: ${lines[firstErrorLine]}`
    };

    if (suspectLines.length > 0) {
      result.summary += '\n\nPossible cause (unclosed brackets before this line):\n' +
        suspectLines.slice(-5).map(l => `Line ${l.lineNumber}: ${l.content}`).join('\n');
    }

    return result;
  }

  // Helper function for HTML escaping - now using global ValidationUtils.escapeHtml
  function escapeHtml(text) {
    return window.escapeHtml ? window.escapeHtml(text) : text;
  }

  // Function to populate brokenIncludeCache from board data on initial load
  function populateBrokenIncludesFromBoard(board) {
    if (!board || !board.columns) return;

    for (const column of board.columns) {
      // Check column-level includes
      if (column.includeError && column.includeFiles) {
        for (const filePath of column.includeFiles) {
          brokenIncludeCache.set(filePath, 'File not found');
          log('Pre-populated broken column include:', filePath);
        }
      }

      // Check task-level includes
      for (const task of column.tasks || []) {
        if (task.includeError && task.includeFiles) {
          for (const filePath of task.includeFiles) {
            brokenIncludeCache.set(filePath, 'File not found');
            log('Pre-populated broken task include:', filePath);
          }
        }
      }
    }
  }

  // Expose cache update function globally
  if (typeof window !== 'undefined') {
    window.updateIncludeFileCache = updateFileCache;
    window.populateBrokenIncludesFromBoard = populateBrokenIncludesFromBoard;
  }

  return markdownItInclude;
}));
