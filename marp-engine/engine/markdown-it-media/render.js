/**
 * @typedef {import("markdown-it/lib/renderer.mjs").RenderRule} RenderRule
 */

const MARP_VIDEO_BEHAVIOR_SCRIPT = `<script>(function(){if(window.__marpVideoPlugin)return;window.__marpVideoPlugin=true;const parseTimeValue=v=>{if(!v)return NaN;const trimmed=v.trim().replace(/s$/i,"");const num=Number(trimmed);return Number.isNaN(num)?NaN:num};const applyStart=v=>{const start=parseTimeValue(v.dataset.startTime);if(Number.isNaN(start))return;const setStart=()=>{try{v.currentTime=start}catch(e){}};if(v.readyState>=1){setStart();}else{v.addEventListener("loadedmetadata",setStart,{once:true});}};const applyEnd=v=>{const end=parseTimeValue(v.dataset.endTime);const previous=v.__marpVideoEndHandler;if(previous){v.removeEventListener("timeupdate",previous);delete v.__marpVideoEndHandler;}if(Number.isNaN(end))return;const handler=()=>{if(v.currentTime>=end){v.pause();v.removeEventListener("timeupdate",handler);}};v.__marpVideoEndHandler=handler;v.addEventListener("timeupdate",handler);};const updateVideos=()=>{document.querySelectorAll("video").forEach(video=>{applyStart(video);applyEnd(video);});};const stopAll=()=>{document.querySelectorAll("video").forEach(video=>{if(!video.paused)video.pause();applyStart(video);});};const preloadActiveSlideVideos=active=>{if(!active)return;active.querySelectorAll("video").forEach(video=>{if(video.getAttribute("preload")==="none"){video.setAttribute("preload","metadata");}});};let lastActive=null;const checkActive=()=>{const active=document.querySelector("svg.bespoke-marp-slide.bespoke-marp-active");if(active&&active!==lastActive){lastActive=active;stopAll();preloadActiveSlideVideos(active);}};const observe=()=>{if(window.__marpVideoObserver)return;window.__marpVideoObserver=true;const observer=new MutationObserver(()=>checkActive());observer.observe(document.body||document.documentElement,{subtree:true,attributes:true,attributeFilter:["class"]});};const ready=()=>{if(!document.body)return;observe();updateVideos();checkActive();};document.addEventListener("DOMContentLoaded",ready);if(document.readyState!=="loading"){ready();}window.addEventListener("load",ready);document.addEventListener("visibilitychange",()=>{if(document.hidden)stopAll();});})();<\/script>`;

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

  return `${open}${content}${close}${script}`;
}

module.exports = { renderMedia };
