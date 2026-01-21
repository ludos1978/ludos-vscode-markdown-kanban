// engine.js
// import MarkdownIt, { markdownItAll, markdownItCustom } from '../index'

// https://www.npmjs.com/package/markdown-it-container
const mdItContainer = require("markdown-it-container");

// ============================================
// YAML Stripping Include Plugin
// ============================================
// Pre-processes !!!include(path)!!! to strip YAML frontmatter from included files
// This MUST run BEFORE markdown-it-include to prevent YAML from breaking slide parsing
// Issue: When included files have YAML headers (---\nmarp: true\n---), the --- lines
// are interpreted as slide separators, causing only YAML to show up as a "slide"
const fs = require('fs');
const path = require('path');

const yamlStrippingIncludePlugin = (md, options = {}) => {
  const originalParse = md.parse.bind(md);

  md.parse = (src, env) => {
    // Process !!!include(path)!!! patterns and strip YAML from included content
    const includePattern = /!!!include\(([^)]+)\)!!!/g;
    const processedIncludes = new Set();

    // Get the root directory for resolving paths
    // Use env.root if available, otherwise use current working directory
    const rootDir = (env && env.root) || process.cwd();

    // Recursively process includes
    const processIncludes = (content, currentDir) => {
      return content.replace(includePattern, (match, includePath) => {
        // Trim whitespace and decode URI components
        includePath = includePath.trim();
        try {
          includePath = decodeURIComponent(includePath);
        } catch (e) {
          // If decode fails, use as-is
        }

        // Resolve path relative to current file's directory
        let resolvedPath;
        if (path.isAbsolute(includePath)) {
          resolvedPath = includePath;
        } else {
          resolvedPath = path.resolve(currentDir, includePath);
        }

        // Check for circular includes
        if (processedIncludes.has(resolvedPath)) {
          console.warn(`[Engine] Circular include detected: ${resolvedPath}`);
          return match; // Return original to avoid infinite loop
        }

        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
          console.warn(`[Engine] Include file not found: ${resolvedPath}`);
          return match; // Return original, markdown-it-include will handle the error
        }

        processedIncludes.add(resolvedPath);

        try {
          let fileContent = fs.readFileSync(resolvedPath, 'utf8');

          // Strip YAML frontmatter if present
          // Match: ---\n ... \n---\n at the start of the file
          // Allow trailing spaces/tabs after --- (common from editors)
          const yamlMatch = fileContent.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/);
          if (yamlMatch) {
            fileContent = fileContent.substring(yamlMatch[0].length);
          }

          // Recursively process nested includes in the included file
          const includeDir = path.dirname(resolvedPath);
          fileContent = processIncludes(fileContent, includeDir);

          return fileContent;
        } catch (err) {
          console.error(`[Engine] Error reading include file ${resolvedPath}:`, err);
          return match; // Return original on error
        }
      });
    };

    // Process the source content
    const processedSrc = processIncludes(src, rootDir);

    return originalParse(processedSrc, env);
  };
};

// ============================================
// Speaker Note Plugin: Convert ;; to <!-- -->
// ============================================
// Converts lines starting with ;; to HTML comments (speaker notes)
// Consecutive ;; lines are grouped into a single comment
const speakerNotePlugin = (md) => {
  const originalParse = md.parse.bind(md);
  md.parse = (src, env) => {
    // Convert ;; lines to <!-- --> before parsing
    const lines = src.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith(';;')) {
        // Collect consecutive ;; lines
        const noteLines = [];
        const indent = line.match(/^(\s*)/)?.[1] || '';

        while (i < lines.length && lines[i].trim().startsWith(';;')) {
          const noteContent = lines[i].trim().substring(2).trim();
          noteLines.push(noteContent);
          i++;
        }

        // Convert to HTML comment (Marp speaker note)
        const combinedContent = noteLines.join('\n');
        result.push(`${indent}<!--\n${combinedContent}\n-->`);
      } else {
        result.push(line);
        i++;
      }
    }

    return originalParse(result.join('\n'), env);
  };
};

// ============================================
// Handout Transformer (from marp-handout)
// ============================================
// Transforms Marp render output into handout format
// Triggered by MARP_HANDOUT environment variable

const HandoutTransformer = {
  // Default options
  defaultOptions: {
    layout: 'portrait',        // 'portrait' or 'landscape'
    notesPosition: 'below',    // 'below' or 'beside'
    slidesPerPage: 1,          // 1, 2, 3, 4, or 6
    direction: 'horizontal',   // 'horizontal' (left-right) or 'vertical' (top-bottom) for 2-slide layout
    includeWritingSpace: false,
    writingSpaceLines: 6,
    slideNumbering: true,
    pageSize: 'A4',
    noteFormat: 'markdown'
  },

  // Parse options from environment variables
  getOptions() {
    return {
      ...this.defaultOptions,
      layout: process.env.MARP_HANDOUT_LAYOUT || this.defaultOptions.layout,
      notesPosition: process.env.MARP_HANDOUT_NOTES_POSITION || this.defaultOptions.notesPosition,
      slidesPerPage: parseInt(process.env.MARP_HANDOUT_SLIDES_PER_PAGE || '1', 10),
      direction: process.env.MARP_HANDOUT_DIRECTION || this.defaultOptions.direction,
      includeWritingSpace: process.env.MARP_HANDOUT_WRITING_SPACE === 'true',
      slideNumbering: process.env.MARP_HANDOUT_SLIDE_NUMBERING !== 'false',
      pageSize: process.env.MARP_HANDOUT_PAGE_SIZE || this.defaultOptions.pageSize
    };
  },

  // Main transform function
  transform(renderResult) {
    const options = this.getOptions();
    const { html, css, comments } = renderResult;
    const slides = Array.isArray(html) ? html : [html];

    console.log(`[Handout] Transforming ${slides.length} slides to handout format (${options.layout})`);

    let transformedHTML;
    if (options.slidesPerPage > 1) {
      transformedHTML = this.createMultiSlidePages(slides, comments || [], options);
    } else {
      transformedHTML = this.createSingleSlidePages(slides, comments || [], options);
    }

    const fullHTML = this.wrapInDocument(transformedHTML, css, options);

    return {
      html: fullHTML,
      css: css + this.getHandoutStyles(options),
      comments
    };
  },

  createSingleSlidePages(slides, comments, options) {
    return slides.map((slide, idx) => {
      const notes = comments[idx] || [];
      return this.createHandoutPage(slide, notes, idx + 1, options);
    });
  },

  createMultiSlidePages(slides, comments, options) {
    const pages = [];
    const perPage = options.slidesPerPage;

    for (let i = 0; i < slides.length; i += perPage) {
      const pageSlides = slides.slice(i, i + perPage);
      const pageNotes = comments.slice(i, i + perPage);
      pages.push(this.createMultiSlidePage(pageSlides, pageNotes, i, options));
    }

    return pages;
  },

  createHandoutPage(slideHTML, notes, slideNumber, options) {
    const notesHTML = this.formatNotes(notes);
    const writingSpace = options.includeWritingSpace ? this.createWritingSpace(options) : '';
    const slideNumberEl = options.slideNumbering ? `<div class="slide-number">${slideNumber}</div>` : '';
    const layoutClass = options.layout === 'landscape' ? 'marp-handout-landscape' : '';

    return `
      <div class="marp-handout-page ${layoutClass}" data-slide="${slideNumber}">
        <div class="marp-handout-slide-container">
          <div class="marp-handout-slide-wrapper">
            ${slideHTML}
          </div>
          ${slideNumberEl}
        </div>
        <div class="marp-handout-notes-container">
          <h3>Notes</h3>
          ${notesHTML}
          ${writingSpace}
        </div>
      </div>
    `;
  },

  createMultiSlidePage(slides, notes, startIdx, options) {
    const slideGrids = slides.map((slide, i) => {
      const slideNumber = startIdx + i + 1;
      const slideNotes = notes[i] || [];

      return `
        <div class="marp-handout-multi-slide-item">
          <div class="marp-handout-slide-mini">
            ${slide}
            <div class="slide-number-mini">${slideNumber}</div>
          </div>
          <div class="marp-handout-notes-mini">
            ${this.formatNotes(slideNotes, true)}
          </div>
        </div>
      `;
    }).join('');

    const directionClass = options.slidesPerPage === 2 ? `marp-handout-${options.direction || 'horizontal'}` : '';
    return `
      <div class="marp-handout-page marp-handout-multi">
        <div class="marp-handout-grid marp-handout-grid-${options.slidesPerPage} ${directionClass}">
          ${slideGrids}
        </div>
      </div>
    `;
  },

  formatNotes(notes, compact = false) {
    if (!notes || notes.length === 0) {
      return '<p class="no-notes">No presenter notes</p>';
    }

    const joined = notes.join('\n\n');
    return `<div class="notes-markdown ${compact ? 'compact' : ''}">${this.simpleMarkdown(joined)}</div>`;
  },

  simpleMarkdown(text) {
    return text
      .split('\n\n')
      .map(paragraph => {
        if (paragraph.startsWith('- ')) {
          const items = paragraph.split('\n').map(line =>
            `<li>${this.escapeHtml(line.replace(/^- /, ''))}</li>`
          ).join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${this.escapeHtml(paragraph)}</p>`;
      })
      .join('');
  },

  createWritingSpace(options) {
    const lines = Array(options.writingSpaceLines || 6)
      .fill('')
      .map(() => '<div class="writing-line"></div>')
      .join('');

    return `
      <div class="marp-handout-writing-space">
        <h4>Additional Notes:</h4>
        <div class="writing-lines">
          ${lines}
        </div>
      </div>
    `;
  },

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  wrapInDocument(pages, css, options) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Handout</title>
  <style>
    ${css}
    ${this.getHandoutStyles(options)}
  </style>
</head>
<body>
  <div class="marp-handout-document">
    ${pages.join('\n')}
  </div>
</body>
</html>`;
  },

  getHandoutStyles(options) {
    const isPortrait = options.layout === 'portrait';
    const pageSize = options.pageSize || 'A4';

    return `
      /* Handout Styles */
      @page {
        size: ${pageSize} ${isPortrait ? 'portrait' : 'landscape'};
        margin: 10mm;
      }

      html, body {
        margin: 0;
        padding: 0;
        background: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .marp-handout-document {
        width: 100%;
        max-width: ${isPortrait ? '210mm' : '297mm'};
        margin: 0 auto;
        padding: 0;
      }

      .marp-handout-page {
        page-break-after: always;
        break-after: page;
        display: flex;
        flex-direction: ${isPortrait ? 'column' : 'row'};
        gap: 5mm;
        padding: 5mm;
        box-sizing: border-box;
        min-height: ${isPortrait ? '277mm' : '190mm'};
        background: white;
      }

      .marp-handout-page:last-child {
        page-break-after: auto;
        break-after: auto;
      }

      /* Multi-slide pages need block display for grid to work properly */
      .marp-handout-page.marp-handout-multi {
        display: block;
        height: ${isPortrait ? '277mm' : '190mm'};
      }

      .marp-handout-slide-container {
        flex: 0 0 ${isPortrait ? '45%' : '55%'};
        border: 2px solid #333;
        overflow: hidden;
        position: relative;
        background: white;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .marp-handout-slide-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .marp-handout-slide-wrapper > svg,
      .marp-handout-slide-wrapper > div.marpit > svg {
        width: 100% !important;
        height: auto !important;
        max-height: 100%;
      }

      .slide-number {
        position: absolute;
        bottom: 5px;
        right: 10px;
        background: #333;
        color: white;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 12px;
        font-weight: bold;
        z-index: 10;
      }

      .marp-handout-notes-container {
        flex: 1;
        padding: 5mm;
        background: #fafafa;
        border: 1px solid #ddd;
        overflow: visible;
        font-size: 11pt;
        line-height: 1.5;
      }

      .marp-handout-notes-container h3 {
        margin: 0 0 3mm 0;
        padding-bottom: 2mm;
        border-bottom: 2px solid #333;
        font-size: 12pt;
        font-weight: bold;
      }

      .marp-handout-notes-container p {
        margin: 2mm 0;
      }

      .no-notes {
        color: #999;
        font-style: italic;
      }

      .notes-markdown, .notes-plain {
        font-size: 10pt;
      }

      .marp-handout-writing-space {
        margin-top: 5mm;
        padding-top: 3mm;
        border-top: 1px dashed #ccc;
      }

      .marp-handout-writing-space h4 {
        margin: 0 0 3mm 0;
        font-size: 10pt;
        color: #666;
      }

      .writing-lines {
        display: flex;
        flex-direction: column;
        gap: 6mm;
      }

      .writing-line {
        border-bottom: 1px solid #ccc;
        height: 5mm;
      }

      /* Multi-slide Grid */
      .marp-handout-multi .marp-handout-grid {
        display: grid;
        gap: 5mm;
        height: 100%;
        width: 100%;
      }

      /* 2 slides per page - landscape: 2 rows, each with slide + notes side by side */
      .marp-handout-grid-2 {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr 1fr;
      }
      .marp-handout-grid-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
      /* 4 slides per page - portrait: 2x2 grid */
      .marp-handout-grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
      .marp-handout-grid-6 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }

      .marp-handout-multi-slide-item {
        display: flex;
        flex-direction: column;
        border: 1px solid #ddd;
        overflow: hidden;
        height: 100%;
      }

      /* For 2 slides per page - horizontal (left-right): slide and notes side by side */
      .marp-handout-grid-2.marp-handout-horizontal .marp-handout-multi-slide-item {
        flex-direction: row !important;
      }

      .marp-handout-grid-2.marp-handout-horizontal .marp-handout-slide-mini {
        flex: 0 0 50% !important;
        max-width: 50%;
      }

      .marp-handout-grid-2.marp-handout-horizontal .marp-handout-notes-mini {
        flex: 1 !important;
      }

      /* For 2 slides per page - vertical (top-bottom): slide above notes */
      .marp-handout-grid-2.marp-handout-vertical .marp-handout-multi-slide-item {
        flex-direction: column !important;
        gap: 3mm;
      }

      .marp-handout-grid-2.marp-handout-vertical .marp-handout-slide-mini {
        flex: 0 0 auto !important;
        width: 100%;
        aspect-ratio: 16 / 9;
        border: 1px solid #333;
        box-sizing: border-box;
      }

      .marp-handout-grid-2.marp-handout-vertical .marp-handout-slide-mini svg {
        width: 100% !important;
        height: auto !important;
        max-height: 100%;
        display: block;
      }

      .marp-handout-grid-2.marp-handout-vertical .marp-handout-notes-mini {
        flex: 1 1 auto !important;
        overflow-y: auto;
        background: #f8f8f8;
        padding: 2mm;
      }

      .marp-handout-slide-mini {
        flex: 0 0 60%;
        position: relative;
        overflow: hidden;
        background: white;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .marp-handout-slide-mini svg {
        width: 100% !important;
        height: auto !important;
        max-height: 100%;
      }

      .slide-number-mini {
        position: absolute;
        bottom: 2px;
        right: 5px;
        font-size: 9px;
        background: #333;
        color: white;
        padding: 1px 4px;
        border-radius: 2px;
      }

      .marp-handout-notes-mini {
        flex: 1;
        padding: 3mm;
        background: #f8f8f8;
        font-size: 8pt;
        line-height: 1.3;
        overflow: hidden;
      }

      @media print {
        html, body {
          width: 100%;
          height: 100%;
        }

        .marp-handout-page {
          min-height: 0;
          height: ${isPortrait ? '277mm' : '190mm'};
          box-sizing: border-box;
        }

        .marp-handout-page.marp-handout-multi {
          height: ${isPortrait ? '277mm' : '190mm'};
          display: block;
        }

        .marp-handout-multi .marp-handout-grid {
          height: 100%;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .marp-handout-multi-slide-item {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        /* Ensure vertical grid columns work in print */
        .marp-handout-grid-2.marp-handout-vertical {
          grid-template-columns: 1fr 1fr !important;
          grid-template-rows: 1fr !important;
        }

        * {
          -webkit-print-color-adjust: exact !important;
          color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      }
    `;
  }
};

// ============================================
// Handout render wrapper
// ============================================
// Wraps marp.render() to apply handout transformation when MARP_HANDOUT=true
const wrapRenderForHandout = (marp) => {
  const originalRender = marp.render.bind(marp);

  marp.render = (markdown, options = {}) => {
    // Always get array format for handout processing
    const renderOptions = {
      ...options,
      htmlAsArray: process.env.MARP_HANDOUT === 'true' ? true : options.htmlAsArray
    };

    const result = originalRender(markdown, renderOptions);

    // Apply handout transformation if enabled
    if (process.env.MARP_HANDOUT === 'true') {
      console.log('[Engine] Handout mode enabled, transforming output...');
      return HandoutTransformer.transform(result);
    }

    return result;
  };

  return marp;
};

// ---
// marpitFragmentedTableRowPlugin
// for each row in a table add data-marpit-fragment
const marpitFragmentedTableRowPlugin = (md) => {
  md.core.ruler.after('block', 'marpit_fragmented_table_row', (state) => {
    if (state.inlineMode) return

    let inTBody = false

    // Add data-marpit-fragment attribute to every rows in table body
    for (const token of state.tokens) {
      if (inTBody) {
        if (token.type === 'tr_open') {
          token.attrSet('data-marpit-fragment', '')
        } else if (token.type === 'tbody_close') {
          inTBody = false
        }
      } else if (token.type === 'tbody_open') {
        inTBody = true
      }
    }
  })
}
// ---

// ---
// create fragmented list using the '+' character
// + list
// + otheritem
// ---
const fragmentedListMarkupsPlus = ['+']
function _fragment_plus(md) {
  // Fragmented list
  md.core.ruler.after('marpit_directives_parse', 'marpit_fragment', (state) => {
    if (state.inlineMode) return
 
    for (const token of state.tokens) {
      if (
        token.type === 'list_item_open' &&
        fragmentedListMarkupsPlus.includes(token.markup)
      ) {
        token.meta = token.meta || {}
        token.meta.marpitFragment = true

        token.attrSet('style', 'marpit-fragments-plus')
      }
    }
  })
 
  // Add data-marpit-fragment(s) attributes to token
  md.core.ruler.after('marpit_fragment', 'marpit_apply_fragment', (state) => {
    if (state.inlineMode) return

    const fragments = { slide: undefined, count: 0 }

    for (const token of state.tokens) {
      if (token.meta && token.meta.marpitSlideElement === 1) {
        fragments.slide = token
        fragments.count = 0
      } else if (token.meta && token.meta.marpitSlideElement === -1) {
        if (fragments.slide && fragments.count > 0) {
          fragments.slide.attrSet('data-marpit-fragments', fragments.count)
        }
      } else if (token.meta && token.meta.marpitFragment) {
        fragments.count += 1
 
        token.meta.marpitFragment = fragments.count
        token.attrSet('data-marpit-fragment', fragments.count)
      }
    }
  })
}
// ---


const _customImageCaption = (md) => {
  // console.log(md.renderer.rules);
  var old = md.renderer.rules.image;

  md.renderer.rules.image = function (tokens, idx, options, env, self) {
    let result = ``;
    result += `<!-- type=${tokens[idx].type} -->`;

    if ("image" == tokens[idx].type) {
      // if (tokens[idx].attrs[2]) {
      let attrs = tokens[idx].attrs;
      let content = tokens[idx].content;
      let attrsTitle;
      let attrsStyle;
      let attrsSrc;
      for (let i = 0; i < attrs.length; i++) {
        if ("title" == attrs[i][0]) {
          attrsTitle = attrs[i][1];
        }
        if ("style" == attrs[i][0]) {
          attrsStyle = attrs[i][1];
        }
        if ("src" == attrs[i][0]) {
          attrsSrc = attrs[i][1];
        }
      }

      if (false) {
        result += `<img `;
        if (attrsSrc !== undefined) {
          result += `src="${attrsSrc}" `;
        }
        if (attrsTitle !== undefined) {
          result += `title="${attrsTitle}" `;
        }
        if (attrsStyle !== undefined) {
          result += `style="${attrsStyle}" `;
        }
        result += `alt="${content}" />`;
      }

      if (attrsTitle !== undefined) {
        result += `<figcaption>${attrsTitle}</figcaption>`;
      }

      if (false) {
        let test = "<!--";
        for (let key in tokens[idx]) {
          if (tokens[idx].hasOwnProperty(key)) {
            // To ensure you're only listing own properties
            //console.log(`Key: ${key}, Value: ${person[key]}`);
            test += `, Key: ${key}, Value: ${tokens[idx][key]}`;
          }
        }
        test += "-->";
        result += test;
      }

      return old(tokens, idx, options, env, self) + result;
    }
  };
};

// import deflistPlugin from './markdown-it-deflist.js';
// const deflistPlugin = require('./markdown-it-deflist.js').default;


// import markdownItMedia from "@gotfeedback/markdown-it-media";

module.exports = ({ marp }) => {
  // Apply speaker note plugin first (;; to <!-- --> conversion)
  marp.use(speakerNotePlugin);

  // Apply YAML-stripping include plugin BEFORE markdown-it-include
  // This plugin processes !!!include()!!! patterns and strips YAML frontmatter
  // from included files to prevent YAML headers from breaking Marp slide parsing
  marp.use(yamlStrippingIncludePlugin);

  // Apply all other plugins
  marp
    // https://www.npmjs.com/package/markdown-it-include
    // !!!include(path)!!! - NOTE: yamlStrippingIncludePlugin processes includes first,
    // so markdown-it-include acts as a fallback for any unprocessed patterns
    .use(require("markdown-it-include"))

    // https://www.npmjs.com/package/markdown-it-strikethrough-alt
    // --Strikeout-- => <s>Strikeout</s>
    .use(require("markdown-it-strikethrough-alt"))

    // https://www.npmjs.com/package/markdown-it-underline
    // _underline_ *emphasis*
    .use(require("markdown-it-underline"))

    // https://www.npmjs.com/package/markdown-it-sub
    // H~2~0 => H<sub>2</sub>O
    .use(require("markdown-it-sub"))

    // https://www.npmjs.com/package/markdown-it-sup
    // 29^th^ => 29<sup>th</sup>
    .use(require("markdown-it-sup"))

    // https://www.npmjs.com/package/markdown-it-mark
    // ==marked== => <mark>inserted</mark>
    .use(require("markdown-it-mark"))

    // https://www.npmjs.com/package/markdown-it-ins
    // ++inserted++ => <ins>inserted</ins>
    .use(require("markdown-it-ins"))

    // https://www.npmjs.com/package/markdown-it-video
    // @[youtube](http://www.youtube.com/embed/dQw4w9WgXcQ)
    // allows exernal video (youtube, ...) with @[]()
    // combine with
    // .use(mdItVideo, {
    //     youtube: { width: 800, height: 600 },
    //     vimeo: { width: 500, height: 281 },
    //     vine: { width: 600, height: 600, embed: 'simple' },
    //     prezi: { width: 550, height: 400 }
    // })
    // .use(require("markdown-it-video"), {
    //   youtube: { },
    //   vimeo: { },
    //   vine: { embed: "simple" },
    //   prezi: { },
    // })

    // https://www.npmjs.com/package/markdown-it-html5-embed
    // allows local video with ![]()
    // combine with
    // .use(mdItHtml5Embed, {
    //     html5embed: {
    //       useImageSyntax: true, // Enables video/audio embed with ![]() syntax (default)
    //       //useLinkSyntax: true   // Enables video/audio embed with []() syntax
    // }})
    // .use(require("markdown-it-html5-embed"), {
    //   html5embed: {
    //     useImageSyntax: true,
    //     attributes: {
    //       audio: 'width="320" controls class="audioplayer"',
    //       video: 'class="audioplayer" controls',
    //     },
    //   },
    // })


		// https://www.npmjs.com/package/@gotfeedback/markdown-it-media
    // Media size: =WxH (see @mdit/img-size).
    // Multiple sources: ![media/type](/path/to/alt-media.mp4).
    // Thumbnails: #=/path/to/poster.jpeg.
    // Captions: [lang](/path/to/captions.lang.vtt).
		// .use(require("@gotfeedback/markdown-it-media").default, {
		// ![](./video.mp4 #=./img.jpg =100x100)
		.use(require("./markdown-it-media").default, {
			controls: true,
			attrs: {
				image: {},
				audio: {},
				video: {},
				},
			}
		)

    // https://github.com/ArcticLampyrid/markdown-it-multicolumn
    // ---:1
    // Hi, W=1/6
    // :--:2
    // Hi, W=1/3
    // :--:3
    // Hi, W=1/2
    // :---
    .use(require("markdown-it-multicolumn").default)
    
    // https://www.npmjs.com/package/markdown-it-abbr
    // *[HTML]: Hyper Text Markup Language
    // *[W3C]:  World Wide Web Consortium
    // The HTML specification
    // is maintained by the W3C.
    .use(require("markdown-it-abbr"))

    // https://www.npmjs.com/package/@peaceroad/markdown-it-footnote-here
    // A paragraph.[^1]
    // [^1]: A footnote.
    .use(require("markdown-it-footnote-here"))

    // https://www.npmjs.com/package/markdown-it-image-figures
    // <figure><img ...></figure>
    // figcaption: Set figcaption to true or "title" to use the title as a <figcaption> block after the image; 
    // set figcaption to "alt" to use the alt text as a <figcaption>. 
    // E.g.: ![This is an alt](fig.png "This is a title")
    .use(require("markdown-it-image-figures"), {
      figcaption: 'title'
    })

    .use(mdItContainer, "note")
		.use(mdItContainer, "comment")
    .use(mdItContainer, "highlight")
    .use(mdItContainer, "mark-red")
    .use(mdItContainer, "mark-green")
    .use(mdItContainer, "mark-blue")
    .use(mdItContainer, "mark-cyan")
    .use(mdItContainer, "mark-magenta")
		.use(mdItContainer, "mark-yellow")

    .use(mdItContainer, "center")
    .use(mdItContainer, "center100")
    .use(mdItContainer, "right")
    .use(mdItContainer, "caption")

    .use(mdItContainer, "columns")
    .use(mdItContainer, "columns3")
    
    .use(mdItContainer, "small66")
    .use(mdItContainer, "small50")
    .use(mdItContainer, "small33")
    .use(mdItContainer, "small25")

    // https://www.npmjs.com/package/markdown-it-anchor
    // adds id attribute to headings
    .use(require("markdown-it-anchor"), {
      permalink: false,
      permalinkBefore: true,
      permalinkSymbol: "§",
    })

    // https://www.npmjs.com/package/markdown-it-toc-done-right
    // [toc]
    .use(require("markdown-it-toc-done-right"), {level: 1})

    // this is broken
    // https://www.npmjs.com/package/mermaid-it
    // ~~~mermaid
    //   graph TD
    //     A[Christmas] -->|Get money| B(Go shopping)
    //     B --> C{Let me think}
    //     C -->|One| D[Laptop]
    //     C -->|Two| E[iPhone]
    //     C -->|Three| F[Car]
    // ~~~
    .use(require('mermaid-it'))

    //
    // 
    // .use(_customImageCaption)

    // create fragmented list using the '+' character
    // + list
    // + otheritem
    .use(_fragment_plus)

    // [ ] unchecked
    // [x] checked
    // .use(require('markdown-it-checkbox'));
    .use(require('markdown-it-checkboxes'))
		
		// this one works partially
		.use(require('./markdown-it-deflist-modified.js').default);
		// .use(require('markdown-it-deflist'))

  // Wrap render for handout support (triggered by MARP_HANDOUT env var)
  wrapRenderForHandout(marp);

  return marp;
};

    // 
    // .use(require(markdown-it-plugins))

    // https://www.npmjs.com/package/markdown-it-footnote
    // Here is a footnote reference,[^1] and another.[^longnote]
    // [^1]: Here is the footnote.
    // ^[Inlines notes are easier to write, since you don't have to pick an identifier and move down to type the note.]
    // .use(require("markdown-it-footnote")

    // .use(require("markdown-it-figure-caption"))
    // .use(require("markdown-it-image-caption"))

    // https://www.npmjs.com/package/markdown-it-all
    // .use(require("markdown-it-all").markdownItCustom, {
    //     abbreviation: true,
    //     // customContainer: string[],
    //     definitionList: true,
    //     emoji: true,
    //     footnote: true,
    //     // githubToc: GithubTocOptions,
    //     insert: true,
    //     // latex: true,
    //     mark: true,
    //     // mermaid: true,
    //     // sourceMap: true,
    //     subscript: true,
    //     superscript: true,
    //     taskList: true,
    // })

    // https://www.npmjs.com/package/markdown-it-deflist
    // Term 1
    // :   Definition
    // with lazy continuation.
    // .use( require("markdown-it-deflist"))

    // https://www.npmjs.com/package/markdown-it-emph
    // _italic_ *emphasis* __bold__ **strong** ____underline____
    // .use(require("markdown-it-emph"))

