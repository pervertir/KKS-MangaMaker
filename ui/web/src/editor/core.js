export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "value" || (k in el && typeof v !== "string")) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = () => Math.random().toString(36).slice(2, 10);
export const deep = o => JSON.parse(JSON.stringify(o));
export const api = async (path, opts = {}) => {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
};
// X-MangaMaker: the server refuses writes without it, so other websites can't drive it (see Handler.allowed)
export const post = (path, body, raw) => api(path, { method: "POST", headers: { "X-MangaMaker": "1" }, body: raw ? body : JSON.stringify(body || {}) });

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_core() {
  /* MangaMaker editor. One document = pages of layers in page pixels (1800x2700, like `mangapipe page`).
     Layer types: panel (rect + shot render, fit/focus/zoom like the pipeline), bubble (Comics template +
     fitted text), caption (box + text), text (dialogue / SFX), image (decor, speed lines, uploads). */
  "use strict";
}
