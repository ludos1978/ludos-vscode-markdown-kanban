/**
 * @typedef {import("markdown-it/lib/renderer.mjs").RenderRule} RenderRule
 */

// CSS to show media fallback links only in print (PDF/PPTX) - hidden in interactive HTML
const MEDIA_FALLBACK_STYLES = `<style>.media-fallback{display:none}@media print{.media-fallback{display:block}}</style>`;

const MARP_VIDEO_BEHAVIOR_SCRIPT = `<script>(function(){if(window.__marpVideoPlugin)return;window.__marpVideoPlugin=true;const parseTimeValue=v=>{if(!v)return NaN;const trimmed=v.trim().replace(/s$/i,"");const num=Number(trimmed);return Number.isNaN(num)?NaN:num};const applyStart=v=>{const start=parseTimeValue(v.dataset.startTime);if(Number.isNaN(start))return;const setStart=()=>{try{v.currentTime=start}catch(e){}};if(v.readyState>=1){setStart();}else{v.addEventListener("loadedmetadata",setStart,{once:true});}};const applyEnd=v=>{const end=parseTimeValue(v.dataset.endTime);const previous=v.__marpVideoEndHandler;if(previous){v.removeEventListener("timeupdate",previous);delete v.__marpVideoEndHandler;}if(Number.isNaN(end))return;const handler=()=>{if(v.currentTime>=end){v.pause();v.removeEventListener("timeupdate",handler);}};v.__marpVideoEndHandler=handler;v.addEventListener("timeupdate",handler);};const updateVideos=()=>{document.querySelectorAll("video").forEach(video=>{applyStart(video);applyEnd(video);});};const stopAll=()=>{document.querySelectorAll("video").forEach(video=>{if(!video.paused)video.pause();applyStart(video);});};const preloadActiveSlideVideos=active=>{if(!active)return;active.querySelectorAll("video").forEach(video=>{if(video.getAttribute("preload")==="none"){video.setAttribute("preload","metadata");}});};let lastActive=null;const checkActive=()=>{const active=document.querySelector("svg.bespoke-marp-slide.bespoke-marp-active");if(active&&active!==lastActive){lastActive=active;stopAll();preloadActiveSlideVideos(active);}};const observe=()=>{if(window.__marpVideoObserver)return;window.__marpVideoObserver=true;const observer=new MutationObserver(()=>checkActive());observer.observe(document.body||document.documentElement,{subtree:true,attributes:true,attributeFilter:["class"]});};const ready=()=>{if(!document.body)return;observe();updateVideos();checkActive();};document.addEventListener("DOMContentLoaded",ready);if(document.readyState!=="loading"){ready();}window.addEventListener("load",ready);document.addEventListener("visibilitychange",()=>{if(document.hidden)stopAll();});})();<\/script>`;

/**
 * Escape HTML entities to prevent XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extract filename from a path or URL
 * @param {string} src
 * @returns {string}
 */
function extractFilename(src) {
  if (!src) return '';
  // Remove query string and hash
  const cleanSrc = src.split('?')[0].split('#')[0];
  // Get the last part of the path
  const parts = cleanSrc.split('/');
  return decodeURIComponent(parts[parts.length - 1] || src);
}

/**
 * Check if a source is a URL (http/https)
 * @param {string} src
 * @returns {boolean}
 */
function isUrl(src) {
  return /^https?:\/\//i.test(src);
}

/** @type {RenderRule} */
function renderMedia(tokens, index, options, env, renderer) {
  const token = tokens[index];
  const attrs = renderer.renderAttrs(token);

  const open = `<${token.tag}${attrs}>`;
  const close = `</${token.tag}>`;

  let content = "";
  if (token.children) {
    content = renderer.renderInline(token.children, options, env);
  }

  const script = token.tag === "video" ? MARP_VIDEO_BEHAVIOR_SCRIPT : "";

  // Check for title attribute to add figcaption
  const titleAttr = token.attrGet('title');

  // Get source URL for fallback display (useful in PDF/PPTX where video can't play)
  // Source is on child <source> elements, not on the main token
  let srcAttr = null;
  if (token.children) {
    for (const child of token.children) {
      if (child.tag === 'source') {
        srcAttr = child.attrGet('src');
        if (srcAttr) break;
      }
    }
  }

  let fallbackLink = '';

  // For video/audio, add a print-friendly fallback link
  // This shows the filename/URL when the media can't be played (PDF, PPTX)
  // Hidden in HTML via CSS, shown only in @media print
  if ((token.tag === 'video' || token.tag === 'audio') && srcAttr) {
    const escapedSrc = escapeHtml(srcAttr);
    const displayText = isUrl(srcAttr) ? escapedSrc : escapeHtml(extractFilename(srcAttr));
    const icon = token.tag === 'video' ? '🎬' : '🔊';

    // Include styles (they dedupe in browser, but only need them once per page)
    // The .media-fallback class is hidden by default, shown only in @media print
    fallbackLink = `${MEDIA_FALLBACK_STYLES}<p class="media-fallback" style="margin:0.5em 0 0 0;font-size:0.8em;color:#666;"><a href="${escapedSrc}" style="color:#0066cc;text-decoration:none;">${icon} ${displayText}</a></p>`;
  }

  if (titleAttr) {
    const escapedTitle = escapeHtml(titleAttr);
    return `<figure class="media-figure">${open}${content}${close}${script}${fallbackLink}<figcaption>${escapedTitle}</figcaption></figure>`;
  }

  return `${open}${content}${close}${script}${fallbackLink}`;
}

module.exports = { renderMedia };
