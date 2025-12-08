// Browser-compatible markdown-it-include plugin
// Processes !!!include(filepath)!!! statements by requesting file content from VS Code

(function(global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() :
  typeof define === "function" && define.amd ? define(factory) :
  (global = typeof globalThis !== "undefined" ? globalThis : global || self,
  global.markdownItInclude = factory());
})(this, (function() {
  "use strict";

  const INCLUDE_RE = /!!!include\(([^)]+)\)!!!/;

  // Cache for file contents to avoid repeated requests
  const fileCache = new Map();
  const pendingRequests = new Set();

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

      // If content is null (not loaded yet), show placeholder
      if (content === null) {
        return `<div class="include-placeholder-block" title="Loading include file: ${escapeHtml(filePath)}">` +
               `📄⏳ Loading: ${escapeHtml(filePath)}` +
               `</div>`;
      }

      // Render the content as markdown
      try {
        const rendered = md.render(content);

        // Create filename display (show just the basename)
        const fileName = filePath.split('/').pop() || filePath;

        // Build bordered container with title bar
        return `<div class="include-container" data-include-file="${escapeHtml(filePath)}">
          <div class="include-title-bar">
            <span class="include-filename-link"
                  data-file-path="${escapeHtml(filePath)}"
                  onclick="handleRegularIncludeClick(event, '${escapeHtml(filePath)}')"
                  title="Alt+click to open file: ${escapeHtml(filePath)}">
              include(${escapeHtml(fileName)})
            </span>
          </div>
          <div class="include-content-area">
            ${rendered}
          </div>
        </div>`;
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
            <span class="include-filename-link"
                  data-file-path="${escapeHtml(filePath)}"
                  onclick="handleRegularIncludeClick(event, '${escapeHtml(filePath)}')"
                  title="Alt+click to open file: ${escapeHtml(filePath)}">
              include(${escapeHtml(fileName)}) - PARSE ERROR
            </span>
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
      }
    };

    // Renderer for inline include content
    md.renderer.rules.include_content = function(tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      const content = token.content;
      const filePath = token.attrGet('data-include-file') || '';

      // Render the content as markdown
      try {
        const rendered = md.render(content);

        // Create filename display (show just the basename)
        const fileName = filePath.split('/').pop() || filePath;

        // Build bordered container with title bar
        return `<div class="include-container" data-include-file="${escapeHtml(filePath)}">
          <div class="include-title-bar">
            <span class="include-filename-link"
                  data-file-path="${escapeHtml(filePath)}"
                  onclick="handleRegularIncludeClick(event, '${escapeHtml(filePath)}')"
                  title="Alt+click to open file: ${escapeHtml(filePath)}">
              include(${escapeHtml(fileName)})
            </span>
          </div>
          <div class="include-content-area">
            ${rendered}
          </div>
        </div>`;
      } catch (error) {
        console.error('Error rendering included content:', error);
        return `<span class="include-error" title="Error rendering included content">Error including: ${escapeHtml(filePath)}</span>`;
      }
    };

    // Renderer for include placeholders
    md.renderer.rules.include_placeholder = function(tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      const filePath = token.content;

      return `<span class="include-placeholder" title="Loading include file: ${escapeHtml(filePath)}">` +
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
        console.error('Error requesting include file:', error);
        pendingRequests.delete(filePath);
      }
    }

    // Return null to indicate content is not available yet
    return null;
  }

  // Track if we've received includes for debouncing
  let includeRenderTimer = null;
  let pendingBoardUpdate = false; // Prevent infinite loop

  // Function to update cache when file content is received
  function updateFileCache(filePath, content) {

    // Remove from pending requests
    pendingRequests.delete(filePath);

    // Check if content actually changed
    const oldContent = fileCache.get(filePath);
    const contentChanged = oldContent !== content;

    // Update cache
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
        console.error('Error registering inline include:', error);
      }
    }

    // Trigger re-render if board already exists
    // On initial load, board renders first (with null includes), then includes arrive
    // We need to re-render to show the includes

    // DON'T trigger re-render here - the backend already sends a boardUpdate message
    // when a regular include file changes. Calling renderBoard() here causes a race
    // condition where the frontend render might use stale data before the backend
    // update arrives.
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

  // Expose cache update function globally
  if (typeof window !== 'undefined') {
    window.updateIncludeFileCache = updateFileCache;
  }

  return markdownItInclude;
}));