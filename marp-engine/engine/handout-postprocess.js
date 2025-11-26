#!/usr/bin/env node
/**
 * Handout Post-Processor for Marp
 *
 * Transforms a Marp-generated HTML presentation into handout format.
 * Can be run standalone or required as a module.
 *
 * Usage:
 *   node handout-postprocess.js input.html [output.html] [options]
 *   node handout-postprocess.js input.html --pdf output.pdf
 *
 * Options (via environment variables):
 *   MARP_HANDOUT_LAYOUT=portrait|landscape
 *   MARP_HANDOUT_SLIDES_PER_PAGE=1|2|3|4|6
 *   MARP_HANDOUT_WRITING_SPACE=true
 *   MARP_HANDOUT_OUTPUT_PDF=true
 */

const fs = require('fs');
const path = require('path');

// Try to load puppeteer (optional for PDF generation)
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  // Puppeteer not available - PDF generation won't work
}

// Default options
const defaultOptions = {
  layout: 'portrait',
  slidesPerPage: 1,
  includeWritingSpace: false,
  writingSpaceLines: 6,
  slideNumbering: true,
  pageSize: 'A4',
  outputPdf: false
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
    pageSize: process.env.MARP_HANDOUT_PAGE_SIZE || defaultOptions.pageSize,
    outputPdf: process.env.MARP_HANDOUT_OUTPUT_PDF === 'true'
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
  // Pattern 1: <div class="bespoke-marp-note" data-index="N">...</div>
  // Notes are indexed by slide number in data-index attribute
  const noteRegex = /<div[^>]*class="[^"]*bespoke-marp-note[^"]*"[^>]*data-index="(\d+)"[^>]*>([\s\S]*?)<\/div>/gi;
  const noteMap = new Map();
  let noteMatch;
  while ((noteMatch = noteRegex.exec(html)) !== null) {
    const index = parseInt(noteMatch[1], 10);
    const content = noteMatch[2].replace(/<[^>]+>/g, '').trim(); // Strip HTML tags
    noteMap.set(index, content);
  }

  // Convert map to array, filling gaps with empty strings
  const maxIndex = Math.max(...noteMap.keys(), -1);
  for (let i = 0; i <= maxIndex; i++) {
    notes.push(noteMap.get(i) || '');
  }

  // Pattern 2: <aside class="marp-note">...</aside> (older Marp versions)
  if (notes.length === 0) {
    const asideNoteRegex = /<aside[^>]*class="[^"]*marp-note[^"]*"[^>]*>([\s\S]*?)<\/aside>/gi;
    while ((noteMatch = asideNoteRegex.exec(html)) !== null) {
      notes.push(noteMatch[1].trim());
    }
  }

  // Pattern 3: <!-- presenter notes in comments --> (fallback)
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
    }

    /* For 2 slides per page (landscape), arrange slide and notes side by side */
    .marp-handout-grid-2 .marp-handout-multi-slide-item {
      flex-direction: row;
    }

    .marp-handout-grid-2 .marp-handout-slide-mini {
      flex: 0 0 50%;
    }

    .marp-handout-grid-2 .marp-handout-notes-mini {
      flex: 1;
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
 * Generate PDF from HTML using Puppeteer
 */
async function generatePdf(htmlContent, outputPath, options) {
  if (!puppeteer) {
    throw new Error('Puppeteer is required for PDF generation. Install with: npm install puppeteer');
  }

  const isPortrait = options.layout === 'portrait';
  const pageSize = options.pageSize || 'A4';

  console.log(`[Handout] Generating PDF: ${outputPath}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Wait a bit for any SVG rendering
    await new Promise(resolve => setTimeout(resolve, 500));

    await page.pdf({
      path: outputPath,
      format: pageSize,
      landscape: !isPortrait,
      printBackground: true,
      margin: {
        top: '10mm',
        bottom: '10mm',
        left: '10mm',
        right: '10mm'
      }
    });

    console.log(`[Handout] PDF written: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

/**
 * Process a file (async version that supports PDF output)
 */
async function processFile(inputPath, outputPath, options) {
  console.log(`[Handout] Processing: ${inputPath}`);

  const inputHtml = fs.readFileSync(inputPath, 'utf-8');
  const outputHtml = transformToHandout(inputHtml, options);

  // Determine output path and type
  let outPath = outputPath || inputPath;
  const isPdfOutput = options.outputPdf || outPath.toLowerCase().endsWith('.pdf');

  if (isPdfOutput) {
    // Generate PDF
    if (!outPath.toLowerCase().endsWith('.pdf')) {
      outPath = outPath.replace(/\.html?$/i, '.pdf');
    }
    await generatePdf(outputHtml, outPath, options);
  } else {
    // Write HTML
    fs.writeFileSync(outPath, outputHtml, 'utf-8');
    console.log(`[Handout] HTML written: ${outPath}`);
  }

  return outPath;
}

/**
 * Process a file (sync version for backward compatibility - HTML only)
 */
function processFileSync(inputPath, outputPath, options) {
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
  processFileSync,
  generatePdf,
  getOptionsFromEnv,
  defaultOptions
};

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node handout-postprocess.js input.html [output.html|output.pdf]');
    console.log('       node handout-postprocess.js input.html --pdf [output.pdf]');
    console.log('');
    console.log('Environment variables:');
    console.log('  MARP_HANDOUT_LAYOUT=portrait|landscape');
    console.log('  MARP_HANDOUT_SLIDES_PER_PAGE=1|2|3|4|6');
    console.log('  MARP_HANDOUT_WRITING_SPACE=true');
    console.log('  MARP_HANDOUT_OUTPUT_PDF=true');
    console.log('  MARP_HANDOUT_PAGE_SIZE=A4|letter|legal');
    process.exit(1);
  }

  // Parse CLI arguments
  const inputPath = args[0];
  let outputPath = null;
  let forcePdf = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--pdf') {
      forcePdf = true;
    } else if (!outputPath) {
      outputPath = args[i];
    }
  }

  // Default output path based on input
  if (!outputPath) {
    outputPath = forcePdf
      ? inputPath.replace(/\.html?$/i, '-handout.pdf')
      : inputPath;
  }

  const options = getOptionsFromEnv();
  if (forcePdf) {
    options.outputPdf = true;
  }

  // Run async
  (async () => {
    try {
      await processFile(inputPath, outputPath, options);
    } catch (error) {
      console.error(`[Handout] Error: ${error.message}`);
      process.exit(1);
    }
  })();
}
