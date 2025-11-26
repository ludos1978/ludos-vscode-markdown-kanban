#!/usr/bin/env node
/**
 * Handout Post-Processor for Marp
 *
 * Transforms a Marp-generated HTML presentation into handout format.
 * Can be run standalone or required as a module.
 *
 * Usage:
 *   node handout-postprocess.js input.html [output.html] [options]
 *
 * Options (via environment variables):
 *   MARP_HANDOUT_LAYOUT=portrait|landscape
 *   MARP_HANDOUT_SLIDES_PER_PAGE=1|2|3|4|6
 *   MARP_HANDOUT_WRITING_SPACE=true
 */

const fs = require('fs');
const path = require('path');

// Default options
const defaultOptions = {
  layout: 'portrait',
  slidesPerPage: 1,
  includeWritingSpace: false,
  writingSpaceLines: 6,
  slideNumbering: true,
  pageSize: 'A4'
};

/**
 * Parse options from environment variables
 */
function getOptionsFromEnv() {
  return {
    ...defaultOptions,
    layout: process.env.MARP_HANDOUT_LAYOUT || defaultOptions.layout,
    slidesPerPage: parseInt(process.env.MARP_HANDOUT_SLIDES_PER_PAGE || '1', 10),
    includeWritingSpace: process.env.MARP_HANDOUT_WRITING_SPACE === 'true',
    slideNumbering: process.env.MARP_HANDOUT_SLIDE_NUMBERING !== 'false',
    pageSize: process.env.MARP_HANDOUT_PAGE_SIZE || defaultOptions.pageSize
  };
}

/**
 * Extract slides and speaker notes from Marp HTML
 */
function extractSlidesAndNotes(html) {
  const slides = [];
  const notes = [];

  // Marp generates SVG slides wrapped in <div class="marpit">
  // Each slide is in a <svg> element with data-marpit-svg
  // Speaker notes are in <aside class="marp-note">

  // Extract all SVG slides
  const svgRegex = /<svg[^>]*data-marpit-svg[^>]*>[\s\S]*?<\/svg>/gi;
  const svgMatches = html.match(svgRegex) || [];

  svgMatches.forEach(svg => {
    slides.push(svg);
  });

  // Extract speaker notes (Marp puts them in different ways depending on template)
  // Pattern 1: <aside class="marp-note">...</aside>
  const noteRegex = /<aside[^>]*class="[^"]*marp-note[^"]*"[^>]*>([\s\S]*?)<\/aside>/gi;
  let noteMatch;
  while ((noteMatch = noteRegex.exec(html)) !== null) {
    notes.push(noteMatch[1].trim());
  }

  // Pattern 2: <!-- presenter notes in comments -->
  // These are usually stripped, but let's check anyway
  if (notes.length === 0) {
    const commentNoteRegex = /<!--\s*([\s\S]*?)\s*-->/g;
    let commentMatch;
    while ((commentMatch = commentNoteRegex.exec(html)) !== null) {
      const content = commentMatch[1].trim();
      // Skip Marp directives and empty comments
      if (content && !content.startsWith('$') && !content.includes('marp')) {
        notes.push(content);
      }
    }
  }

  // Pad notes array to match slides
  while (notes.length < slides.length) {
    notes.push('');
  }

  return { slides, notes };
}

/**
 * Extract original CSS from the HTML
 */
function extractCSS(html) {
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const styles = [];
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    styles.push(match[1]);
  }
  return styles.join('\n');
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format notes as HTML
 */
function formatNotes(noteText, compact = false) {
  if (!noteText || noteText.trim() === '') {
    return '<p class="no-notes">No presenter notes</p>';
  }

  // Simple markdown-like formatting
  const paragraphs = noteText.split(/\n\n+/);
  return paragraphs.map(p => {
    if (p.trim().startsWith('- ')) {
      const items = p.split('\n').map(line =>
        `<li>${escapeHtml(line.replace(/^- /, ''))}</li>`
      ).join('');
      return `<ul class="${compact ? 'compact' : ''}">${items}</ul>`;
    }
    return `<p>${escapeHtml(p)}</p>`;
  }).join('');
}

/**
 * Create writing space HTML
 */
function createWritingSpace(options) {
  const lines = Array(options.writingSpaceLines || 6)
    .fill('')
    .map(() => '<div class="writing-line"></div>')
    .join('');

  return `
    <div class="marp-handout-writing-space">
      <h4>Additional Notes:</h4>
      <div class="writing-lines">${lines}</div>
    </div>
  `;
}

/**
 * Create a single handout page
 */
function createHandoutPage(slideHtml, noteText, slideNumber, options) {
  const notesHtml = formatNotes(noteText);
  const writingSpace = options.includeWritingSpace ? createWritingSpace(options) : '';
  const slideNumberEl = options.slideNumbering ? `<div class="slide-number">${slideNumber}</div>` : '';
  const layoutClass = options.layout === 'landscape' ? 'marp-handout-landscape' : '';

  return `
    <div class="marp-handout-page ${layoutClass}" data-slide="${slideNumber}">
      <div class="marp-handout-slide-container">
        <div class="marp-handout-slide-wrapper">
          ${slideHtml}
        </div>
        ${slideNumberEl}
      </div>
      <div class="marp-handout-notes-container">
        <h3>Notes</h3>
        ${notesHtml}
        ${writingSpace}
      </div>
    </div>
  `;
}

/**
 * Create multi-slide page
 */
function createMultiSlidePage(slides, notes, startIdx, options) {
  const slideGrids = slides.map((slide, i) => {
    const slideNumber = startIdx + i + 1;
    const noteText = notes[i] || '';

    return `
      <div class="marp-handout-multi-slide-item">
        <div class="marp-handout-slide-mini">
          ${slide}
          <div class="slide-number-mini">${slideNumber}</div>
        </div>
        <div class="marp-handout-notes-mini">
          ${formatNotes(noteText, true)}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="marp-handout-page marp-handout-multi">
      <div class="marp-handout-grid marp-handout-grid-${options.slidesPerPage}">
        ${slideGrids}
      </div>
    </div>
  `;
}

/**
 * Get handout CSS styles
 */
function getHandoutStyles(options) {
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

    .marp-handout-slide-wrapper > svg {
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

    .marp-handout-grid-2 { grid-template-columns: 1fr 1fr; }
    .marp-handout-grid-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
    .marp-handout-grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
    .marp-handout-grid-6 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }

    .marp-handout-multi-slide-item {
      display: flex;
      flex-direction: column;
      border: 1px solid #ddd;
      overflow: hidden;
    }

    .marp-handout-slide-mini {
      flex: 0 0 60%;
      position: relative;
      overflow: hidden;
      background: white;
    }

    .marp-handout-slide-mini svg {
      width: 100% !important;
      height: auto !important;
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
        height: auto;
      }

      * {
        -webkit-print-color-adjust: exact !important;
        color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  `;
}

/**
 * Transform Marp HTML to handout format
 */
function transformToHandout(inputHtml, options = {}) {
  const opts = { ...defaultOptions, ...options };

  // Extract slides and notes
  const { slides, notes } = extractSlidesAndNotes(inputHtml);
  const originalCss = extractCSS(inputHtml);

  console.log(`[Handout] Found ${slides.length} slides, ${notes.filter(n => n).length} notes`);

  if (slides.length === 0) {
    console.warn('[Handout] No slides found in HTML');
    return inputHtml;
  }

  // Create handout pages
  let pages = [];

  if (opts.slidesPerPage > 1) {
    // Multi-slide per page
    for (let i = 0; i < slides.length; i += opts.slidesPerPage) {
      const pageSlides = slides.slice(i, i + opts.slidesPerPage);
      const pageNotes = notes.slice(i, i + opts.slidesPerPage);
      pages.push(createMultiSlidePage(pageSlides, pageNotes, i, opts));
    }
  } else {
    // Single slide per page
    pages = slides.map((slide, idx) => {
      return createHandoutPage(slide, notes[idx], idx + 1, opts);
    });
  }

  // Build final HTML
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Handout</title>
  <style>
${originalCss}
${getHandoutStyles(opts)}
  </style>
</head>
<body>
  <div class="marp-handout-document">
${pages.join('\n')}
  </div>
</body>
</html>`;
}

/**
 * Process a file
 */
function processFile(inputPath, outputPath, options) {
  console.log(`[Handout] Processing: ${inputPath}`);

  const inputHtml = fs.readFileSync(inputPath, 'utf-8');
  const outputHtml = transformToHandout(inputHtml, options);

  const outPath = outputPath || inputPath;
  fs.writeFileSync(outPath, outputHtml, 'utf-8');

  console.log(`[Handout] Written: ${outPath}`);
  return outPath;
}

// Export for use as module
module.exports = {
  transformToHandout,
  processFile,
  getOptionsFromEnv,
  defaultOptions
};

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node handout-postprocess.js input.html [output.html]');
    console.log('');
    console.log('Environment variables:');
    console.log('  MARP_HANDOUT_LAYOUT=portrait|landscape');
    console.log('  MARP_HANDOUT_SLIDES_PER_PAGE=1|2|3|4|6');
    console.log('  MARP_HANDOUT_WRITING_SPACE=true');
    process.exit(1);
  }

  const inputPath = args[0];
  const outputPath = args[1] || inputPath;
  const options = getOptionsFromEnv();

  try {
    processFile(inputPath, outputPath, options);
  } catch (error) {
    console.error(`[Handout] Error: ${error.message}`);
    process.exit(1);
  }
}
