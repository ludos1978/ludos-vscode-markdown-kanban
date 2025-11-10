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
      console.log(`[markdown-it-include:block] Processing !!!include(${filePath})!!! - content:`, content ? `${content.length} chars` : 'NULL');

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
      const max = state.posMax;

      // Look for include pattern using match() to avoid regex state issues
      const srcSlice = state.src.slice(start);
      const match = srcSlice.match(options.includeRe);
      if (!match || match.index !== 0) {
        return false;
      }

      if (silent) {return true;}

      const filePath = match[1].trim();

      // Try to get file content
      let content = getFileContent(filePath);
      console.log(`[markdown-it-include:inline] Processing !!!include(${filePath})!!! - content:`, content ? `${content.length} chars` : 'NULL');

      if (content === null) {
        // File not cached yet - show placeholder and request content
        console.log(`[markdown-it-include:inline] ⏳ No cache - showing placeholder for ${filePath}`);
        const token = state.push('include_placeholder', 'span', 0);
        token.content = filePath;
        token.attrSet('class', 'include-placeholder');
        token.attrSet('title', `Loading include file: ${filePath}`);
      } else {
        // Successfully got content - render it inline as markdown
        console.log(`[markdown-it-include:inline] ✅ Cache hit - rendering ${content.length} chars for ${filePath}`);
        const token = state.push('include_content', 'span', 0);
        token.content = content;
        token.attrSet('class', 'included-content-inline');
        token.attrSet('data-include-file', filePath);
      }

      state.pos = start + match[0].length;
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
        // Render as inline content to avoid nested block issues
        const rendered = md.renderInline(content);

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
        return `<div class="include-error" title="Error rendering included content">Error including: ${escapeHtml(filePath)}</div>`;
      }
    };

    // Renderer for inline include content
    md.renderer.rules.include_content = function(tokens, idx, options, env, renderer) {
      const token = tokens[idx];
      const content = token.content;
      const filePath = token.attrGet('data-include-file') || '';

      // Render the content as markdown
      try {
        // Render as inline content - markdown-it will handle block/inline context automatically
        const rendered = md.renderInline(content);

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
    console.log('[updateIncludeFileCache] 🟢 FUNCTION CALLED:', filePath);
    console.log('[updateIncludeFileCache]   content.length:', content ? content.length : 'null');

    // Remove from pending requests
    pendingRequests.delete(filePath);

    // Check if content actually changed
    const oldContent = fileCache.get(filePath);
    const contentChanged = oldContent !== content;
    console.log('[updateIncludeFileCache]   Content changed:', contentChanged);

    // Update cache
    fileCache.set(filePath, content);
    console.log('[updateIncludeFileCache]   ✅ Cache updated, total cached files:', fileCache.size);

    // Register this inline include in the backend's unified system for conflict resolution
    if (typeof vscode !== 'undefined') {
      try {
        vscode.postMessage({
          type: 'registerInlineInclude',
          filePath: filePath,
          content: content
        });
        console.log('[updateIncludeFileCache]   ✅ Sent registerInlineInclude message');
      } catch (error) {
        console.error('Error registering inline include:', error);
      }
    }

    // Trigger re-render if board already exists
    // On initial load, board renders first (with null includes), then includes arrive
    // We need to re-render to show the includes
    console.log('[updateIncludeFileCache]   🔍 Checking render conditions:');
    console.log('[updateIncludeFileCache]     typeof window:', typeof window);
    console.log('[updateIncludeFileCache]     window.cachedBoard:', typeof window !== 'undefined' ? !!window.cachedBoard : 'no window');
    console.log('[updateIncludeFileCache]     window.renderBoard:', typeof window !== 'undefined' ? typeof window.renderBoard : 'no window');

    // DON'T trigger re-render here - the backend already sends a boardUpdate message
    // when a regular include file changes. Calling renderBoard() here causes a race
    // condition where the frontend render might use stale data before the backend
    // update arrives.
    console.log('[updateIncludeFileCache]   ℹ️  Cache updated. Backend will send boardUpdate for regular includes.');
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