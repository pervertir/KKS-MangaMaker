/* MangaMaker editor. One document = pages of layers in page pixels (1800x2700, like `mangapipe page`).
   Layer types: panel (rect + shot render, fit/focus/zoom like the pipeline), bubble (Comics template +
   fitted text), caption (box + text), text (dialogue / SFX), image (decor, speed lines, uploads). */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
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
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const deep = o => JSON.parse(JSON.stringify(o));
const api = async (path, opts = {}) => {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
};
const post = (path, body, raw) => api(path, { method: "POST", body: raw ? body : JSON.stringify(body || {}) });

/* ================================================================ state */
const S = {
  cat: null, shots: [], projects: [],
  doc: null, name: "", page: 0, sel: null, tool: "move",
  view: { s: 0.25, tx: 0, ty: 0 },
  bubble: "001", libTab: "shots", libFilter: "", vshape: "oval", tonePreset: 2, speedMode: "focus",
  adjust: null,           // panel id whose image is being panned/zoomed
  guides: [], showOrder: true, showGuides: true,
  undo: [], redo: [], dirty: false, savedAt: 0,
  jobs: {}, jobView: null, pod: null,
};
const W = () => S.doc.width, H = () => S.doc.height;
const page = () => S.doc.pages[S.page];
const layers = () => page().layers;
const selL = () => layers().find(l => l.id === S.sel) || null;
const bubbleMeta = key => S.cat.bubbles.find(b => b.key === key) || S.cat.bubbles[0];

function newDoc(title = "Untitled") {
  return { version: 1, title, reading: "rtl", width: 1800, height: 2700, maxFont: S.cat?.maxFont || 56,
    pages: [{ id: uid(), bg: "#ffffff", layers: [] }] };
}
function normalize(doc) {
  doc.width ||= 1800; doc.height ||= 2700; doc.reading ||= "rtl"; doc.maxFont ||= 56;
  for (const p of doc.pages) {
    p.id ||= uid(); p.bg ||= "#ffffff"; p.layers ||= [];
    for (const l of p.layers) {
      l.id ||= uid(); l.visible ??= true; l.locked ??= false; l.opacity ??= 1; l.blend ||= "source-over"; l.rotate ||= 0;
      if (l.type === "panel") { l.border ??= 6; l.borderColor ||= "#000000"; l.fill ||= "#ffffff"; }
      if (l.type === "text") { l.font ||= l.sfx ? "Bangers" : "MMComic"; l.stroke ||= "#000000"; l.strokeWidth ??= l.sfx ? 10 : 0; l.align ||= "center"; }
      if (l.type === "caption") { l.fill ||= "#ffffff"; l.borderW ??= 4; }
      if (l.type === "vbubble") { l.shape ||= "oval"; l.fill ||= "#ffffff"; l.stroke ||= "#000000"; l.strokeW ??= 5; l.tailW ??= 0.22; l.seed ??= 1; l.spikes ??= 16; }
      if (l.type === "tone") { l.pattern ||= "dots"; l.size ??= 12; l.density ??= 0.35; l.angle ??= 45; l.fade ||= "none"; l.color ||= "#000000"; l.seed ??= 1; }
      if (l.type === "speed") { l.mode ||= "focus"; l.count ??= 160; l.thick ??= 14; l.inner ??= 0.45; l.jitter ??= 0.35; l.angle ??= 0; l.color ||= "#000000"; l.seed ??= 1; }
      if (["bubble", "caption", "text", "vbubble"].includes(l.type)) { l.color ||= "auto"; l.fontSize ??= 0; l.text ??= ""; }
    }
  }
  return doc;
}

/* ================================================================ history */
function commit(msg) {
  S.undo.push(S.snap); if (S.undo.length > 150) S.undo.shift();
  S.redo = []; snapshot(); S.dirty = true; refreshPanels(); if (msg) status(msg);
}
function snapshot() { S.snap = JSON.stringify({ doc: S.doc, page: S.page }); }
function restore(js) {
  const o = JSON.parse(js); S.doc = o.doc; S.page = Math.min(o.page, S.doc.pages.length - 1);
  if (!selL()) S.sel = null; snapshot(); S.dirty = true; refreshPanels(); renderPages();
}
function undo() { if (!S.undo.length) return; S.redo.push(S.snap); restore(S.undo.pop()); status("Undo"); }
function redo() { if (!S.redo.length) return; S.undo.push(S.snap); restore(S.redo.pop()); status("Redo"); }

/* ================================================================ images */
/* Every picture is fetched at the smallest size that is sharp on screen (256 … 2048 px wide, resized
   and cached by the server), so a zoomed-out page decodes and draws a fraction of the pixels.
   While a sharper level loads, the best one already decoded is drawn instead. */
const IMG = new Map();
const LEVELS = [256, 512, 1024, 2048];
function imgW(ref) { return ref.startsWith("tpl:") ? 2048 : 0; }
function getImg(ref, w = 0) {
  const k = ref + "|" + w;
  let im = IMG.get(k);
  if (!im) {
    im = new Image();
    im.decoding = "async";
    im.onload = () => { requestDraw(); schedThumbs(true); };
    im.src = `/img?ref=${encodeURIComponent(ref)}${w ? "&w=" + w : ""}`;
    IMG.set(k, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
function imgFor(ref, needPx) {
  const lvl = LEVELS.find(v => v >= needPx * 1.15) || LEVELS[LEVELS.length - 1];
  const want = getImg(ref, lvl);
  if (want) return want;
  let best = null;
  for (const v of LEVELS) { const im = IMG.get(ref + "|" + v); if (im?.complete && im.naturalWidth) best = im; }
  return best;
}
const thumb = (ref, w = 240) => `/img?ref=${encodeURIComponent(ref)}&w=${w}`;
function waitImages() {
  const pend = [...IMG.values()].filter(i => !i.complete);
  if (!pend.length) return Promise.resolve();
  return Promise.all(pend.map(i => new Promise(r => { i.onload = i.onerror = r; })));
}

/* ================================================================ text */
const FONTS = [
  ["MMComic", "Dialogue · Comic Sans (pipeline)"], ["Comic Neue", "Dialogue · Comic Neue"], ["Patrick Hand", "Dialogue · Patrick Hand"],
  ["Kalam", "Dialogue · Kalam (handwritten)"], ["Indie Flower", "Dialogue · Indie Flower (whisper)"], ["Architects Daughter", "Dialogue · Architects Daughter"],
  ["Bangers", "SFX · Bangers"], ["Luckiest Guy", "SFX · Luckiest Guy"], ["Permanent Marker", "SFX · Permanent Marker"], ["Shojumaru", "SFX · Shojumaru"],
  ["Rubik Wet Paint", "SFX · Rubik Wet Paint"], ["Creepster", "SFX · Creepster (horror)"], ["Bungee Shade", "SFX · Bungee Shade"], ["Anton", "Title · Anton"],
  ["Black Ops One", "Title · Black Ops One"],
  ["Rampart One", "日本語 · Rampart One (SFX)"], ["Dela Gothic One", "日本語 · Dela Gothic One (SFX)"], ["Reggae One", "日本語 · Reggae One"],
  ["RocknRoll One", "日本語 · RocknRoll One"], ["Potta One", "日本語 · Potta One (brush)"], ["Yusei Magic", "日本語 · Yusei Magic (marker)"],
  ["Mochiy Pop One", "日本語 · Mochiy Pop One"], ["Hachi Maru Pop", "日本語 · Hachi Maru Pop (cute)"], ["Zen Maru Gothic", "日本語 · Zen Maru Gothic (dialogue)"],
  ["Kosugi Maru", "日本語 · Kosugi Maru"], ["Zen Kurenaido", "日本語 · Zen Kurenaido (brush)"], ["Kaisei Decol", "日本語 · Kaisei Decol (mincho)"],
  ["Hiragino Sans", "System · Hiragino Sans"], ["Impact", "System · Impact"], ["Arial Black", "System · Arial Black"], ["Georgia", "System · Georgia"]];
const fontStr = (l, px) => `${l.italic ? "italic " : ""}${l.bold ? "700 " : "400 "}${px}px "${l.font || "MMComic"}", "Comic Sans MS", sans-serif`;
const MEAS = document.createElement("canvas").getContext("2d");
const fitCache = new Map();

function wrap(text, l, px, maxW) {
  MEAS.font = fontStr(l, px);
  const out = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = words[0];
    for (const w of words.slice(1)) {
      const t = line + " " + w;
      if (MEAS.measureText(t).width <= maxW) line = t; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
/* largest size (<= maxPx) whose wrapped lines fit maxW x maxH; fixed size when l.fontSize > 0 */
function fit(text, l, maxW, maxH, maxPx) {
  const key = [text, l.font, l.bold, l.italic, l.fontSize, Math.round(maxW), Math.round(maxH), maxPx, l.vertical].join("|");
  if (fitCache.has(key)) return fitCache.get(key);
  let res;
  const sp = 1.15;
  if (l.vertical) {
    const cols = String(text).split("\n");
    const longest = Math.max(1, ...cols.map(c => [...c].length));
    const px = l.fontSize > 0 ? l.fontSize : clamp(Math.floor(Math.min(maxH / (longest * 1.05), maxW / (cols.length * 1.2))), 8, maxPx);
    res = { px, lines: cols, lh: px * 1.05 };
  } else if (l.fontSize > 0) {
    res = { px: l.fontSize, lines: wrap(text, l, l.fontSize, maxW), lh: l.fontSize * sp };
  } else {
    let lo = 8, hi = Math.max(9, maxPx), best = { px: lo, lines: wrap(text, l, lo, maxW) };
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, lines = wrap(text, l, mid, maxW);
      MEAS.font = fontStr(l, mid);
      const wOk = lines.every(t => MEAS.measureText(t).width <= maxW + 0.5);
      if (wOk && lines.length * mid * sp <= maxH) { best = { px: mid, lines }; lo = mid + 1; } else hi = mid - 1;
    }
    res = { ...best, lh: best.px * sp };
  }
  if (fitCache.size > 3000) fitCache.clear();
  fitCache.set(key, res);
  return res;
}
const fontsAsked = new Set();
function ensureFont(l) {
  const f = fontStr(l, 40);
  if (fontsAsked.has(f)) return;
  fontsAsked.add(f);
  document.fonts.load(f, "あA").then(() => { fitCache.clear(); requestDraw(); schedThumbs(); });
}
function drawText(ctx, l, cx, cy, maxW, maxH, maxPx, color) {
  const text = l.text || "";
  ensureFont(l);
  if (!text.trim()) return;
  const f = fit(text, l, maxW, maxH, maxPx);
  ctx.font = fontStr(l, f.px);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  const sw = l.strokeWidth || 0;
  if (sw) { ctx.lineJoin = "round"; ctx.strokeStyle = l.stroke || "#000"; ctx.lineWidth = sw * 2; }
  if (l.vertical) {
    ctx.textAlign = "center";
    const colW = f.px * 1.2, n = f.lines.length;
    f.lines.forEach((col, i) => {
      const x = cx + (n - 1) * colW / 2 - i * colW;          // columns right to left
      const chars = [...col], y0 = cy - (chars.length - 1) * f.lh / 2;
      chars.forEach((ch, j) => { if (sw) ctx.strokeText(ch, x, y0 + j * f.lh); ctx.fillText(ch, x, y0 + j * f.lh); });
    });
    return;
  }
  const align = l.align || "center";
  ctx.textAlign = align;
  const x = align === "left" ? cx - maxW / 2 : align === "right" ? cx + maxW / 2 : cx;
  let y = cy - (f.lines.length - 1) * f.lh / 2;
  for (const line of f.lines) { if (sw) ctx.strokeText(line, x, y); ctx.fillText(line, x, y); y += f.lh; }
}

/* ================================================================ drawing */
function imageRect(l, im) {
  const I = l.image, iw = I.iw || im?.naturalWidth || 1, ih = I.ih || im?.naturalHeight || 1;
  if (I.fit === "contain") {
    const s = Math.min(l.w / iw, l.h / ih) * (I.zoom || 1);
    return { x: l.x + (l.w - iw * s) / 2, y: l.y + (l.h - ih * s) / 2, w: iw * s, h: ih * s, s };
  }
  const s = Math.max(l.w / iw, l.h / ih) * Math.max(1, I.zoom || 1);
  const sw = iw * s, sh = ih * s;
  const fx = I.focus?.[0] ?? 0.5, fy = I.focus?.[1] ?? 0.5;
  const x0 = clamp(fx * sw - l.w / 2, 0, sw - l.w), y0 = clamp(fy * sh - l.h / 2, 0, sh - l.h);
  return { x: l.x - x0, y: l.y - y0, w: sw, h: sh, s };
}
function withBox(ctx, l, fn) {
  ctx.save();
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  ctx.translate(cx, cy);
  if (l.rotate) ctx.rotate(l.rotate * Math.PI / 180);
  fn(cx, cy);
  ctx.restore();
}
function drawLayer(ctx, l, opt = {}) {
  if (!l.visible) return;
  ctx.save();
  ctx.globalAlpha = l.opacity ?? 1;
  ctx.globalCompositeOperation = l.blend || "source-over";
  const maxFont = S.doc.maxFont || 56;
  switch (l.type) {
    case "panel": {
      ctx.fillStyle = l.fill || "#fff";
      ctx.fillRect(l.x, l.y, l.w, l.h);
      const r0 = l.image ? imageRect(l) : null;
      const im = l.image ? imgFor(l.image.ref, r0.w * (opt.rs || 1)) : null;
      if (l.image && im) {
        const r = r0;
        if (opt.ghost) { ctx.save(); ctx.globalAlpha = 0.3; drawFlipped(ctx, im, r, l.image.flip); ctx.restore(); }
        ctx.save(); ctx.beginPath(); ctx.rect(l.x, l.y, l.w, l.h); ctx.clip();
        drawFlipped(ctx, im, r, l.image.flip);
        ctx.restore();
      } else if (!opt.export) {
        ctx.fillStyle = "#e7e7ea"; ctx.fillRect(l.x, l.y, l.w, l.h);
        ctx.strokeStyle = "#c9c9cf"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(l.x + l.w, l.y + l.h); ctx.moveTo(l.x + l.w, l.y); ctx.lineTo(l.x, l.y + l.h); ctx.stroke();
        ctx.fillStyle = "#8a8a93"; ctx.font = `600 ${clamp(Math.min(l.w, l.h) / 9, 18, 54)}px -apple-system, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(l.shot ? `${l.shot} (no render)` : "drop a render here", l.x + l.w / 2, l.y + l.h / 2);
      }
      if (l.border > 0) {
        ctx.strokeStyle = l.borderColor || "#000"; ctx.lineWidth = l.border;
        ctx.strokeRect(l.x - l.border / 2, l.y - l.border / 2, l.w + l.border, l.h + l.border);
      }
      break;
    }
    case "bubble": {
      const m = bubbleMeta(l.bubble);
      const im = imgFor(m.ref, l.w * (opt.rs || 1));
      withBox(ctx, l, () => {
        if (im) {
          ctx.save(); if (l.flip) ctx.scale(-1, 1);
          ctx.drawImage(im, -l.w / 2, -l.h / 2, l.w, l.h);
          ctx.restore();
        } else { ctx.strokeStyle = "#999"; ctx.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h); }
        let [bx0, by0, bx1, by1] = m.box;
        if (l.flip) [bx0, bx1] = [1 - bx1, 1 - bx0];
        const tx = -l.w / 2 + (bx0 + bx1) / 2 * l.w, ty = -l.h / 2 + (by0 + by1) / 2 * l.h;
        const tw = (bx1 - bx0) * l.w * 0.92, th = (by1 - by0) * l.h * 0.88;
        const col = l.color === "auto" ? (m.dark ? "#ffffff" : "#111111") : l.color;
        ctx.globalCompositeOperation = "source-over";
        drawText(ctx, { ...l, strokeWidth: 0 }, tx, ty, tw, th, maxFont, col);
      });
      break;
    }
    case "caption": {
      withBox(ctx, l, () => {
        ctx.fillStyle = l.fill || "#fff"; ctx.fillRect(-l.w / 2, -l.h / 2, l.w, l.h);
        if (l.borderW > 0) { ctx.strokeStyle = "#000"; ctx.lineWidth = l.borderW; ctx.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h); }
        const pad = Math.min(l.w, l.h) * 0.12 + 6;
        drawText(ctx, { ...l, strokeWidth: 0 }, 0, 0, l.w - pad * 2, l.h - pad * 2, maxFont, l.color === "auto" ? "#111" : l.color);
      });
      break;
    }
    case "text": {
      withBox(ctx, l, () => {
        const big = l.fontSize > 0 ? l.fontSize : Math.max(maxFont, 400);
        drawText(ctx, l, 0, 0, l.w, l.h, big, l.color === "auto" ? "#111" : l.color);
      });
      break;
    }
    case "vbubble": {
      withBox(ctx, l, () => drawVBubble(ctx, l, maxFont));
      break;
    }
    case "tone":
    case "speed": {
      const clip = l.clip && S.doc.pages.flatMap(p => p.layers).find(q => q.id === l.clip);
      if (clip) { ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip(); }
      const art = l.type === "tone" ? toneCanvas(l) : speedCanvas(l);
      withBox(ctx, l, () => ctx.drawImage(art, -l.w / 2, -l.h / 2, l.w, l.h));
      break;
    }
    case "image": {
      const im = imgFor(l.ref, l.w * (opt.rs || 1));
      withBox(ctx, l, () => {
        if (!im) return;
        ctx.save(); if (l.flip) ctx.scale(-1, 1);
        ctx.drawImage(im, -l.w / 2, -l.h / 2, l.w, l.h);
        ctx.restore();
      });
      break;
    }
  }
  ctx.restore();
}
/* ================================================================ manga tools */
function rng(seed) { // mulberry32: same seed, same lines
  let a = (seed * 2654435761) >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const ART = new Map();
const LAST_ART = new Map();
function artCache(key, w, h, paint, id) {
  const live = id && S.drag?.layer?.id === id && LAST_ART.get(id);
  if (live && !ART.has(key)) return live;
  let c = ART.get(key);
  if (!c) {
    c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    paint(c.getContext("2d"), c.width, c.height);
    if (ART.size > 40) ART.delete(ART.keys().next().value);
    ART.set(key, c);
  }
  if (id) LAST_ART.set(id, c);
  return c;
}
/* fade: how strong the tone is at (x, y) inside a w x h box */
function fadeAt(fade, x, y, w, h) {
  switch (fade) {
    case "down": return 1 - y / h;
    case "up": return y / h;
    case "right": return 1 - x / w;
    case "left": return x / w;
    case "edges": return clamp(Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) / 1.2, 0, 1);
    case "center": return clamp(1 - Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) / 1.2, 0, 1);
    default: return 1;
  }
}
function toneCanvas(l) {
  const key = ["tone", l.pattern, l.size, l.density, l.angle, l.fade, l.color, l.seed, Math.round(l.w), Math.round(l.h)].join("|");
  return artCache(key, l.w, l.h, (g, w, h) => {
    g.fillStyle = l.color; g.strokeStyle = l.color;
    const sz = Math.max(2, l.size), a = (l.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    if (l.pattern === "solid") {
      for (let y = 0; y < h; y += 4) { g.globalAlpha = clamp(l.density * fadeAt(l.fade, w / 2, y, w, h), 0, 1); g.fillRect(0, y, w, 4); }
      return;
    }
    if (l.pattern === "noise") {
      const r = rng(l.seed), n = Math.round(w * h / (sz * sz) * 6);
      for (let i = 0; i < n; i++) {
        const x = r() * w, y = r() * h;
        if (r() > l.density * fadeAt(l.fade, x, y, w, h)) continue;
        g.beginPath(); g.arc(x, y, sz * 0.12 + r() * sz * 0.12, 0, 7); g.fill();
      }
      return;
    }
    const R = Math.ceil(Math.hypot(w, h) / 2 / sz) + 1;
    g.beginPath();                                   // one path for all dots: a single fill instead of thousands
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const lx = i * sz, ly = j * sz, x = w / 2 + lx * ca - ly * sa, y = h / 2 + lx * sa + ly * ca;
      if (x < -sz || y < -sz || x > w + sz || y > h + sz) continue;
      const cov = clamp(l.density * fadeAt(l.fade, x, y, w, h), 0, 1);
      if (cov < 0.02) continue;
      if (l.pattern === "dots") { const r = sz * 0.5 * Math.sqrt(cov) * 1.13; g.moveTo(x + r, y); g.arc(x, y, r, 0, 7); continue; }
      g.save(); g.translate(x, y); g.rotate(a);
      const t = sz * cov;
      g.fillRect(-sz / 2 - 0.5, -t / 2, sz + 1, t);                                  // lines
      if (l.pattern === "cross") g.fillRect(-t / 2, -sz / 2 - 0.5, t, sz + 1);         // + the other way
      g.restore();
    }
    if (l.pattern === "dots") g.fill();
  }, l.id);
}
function speedCanvas(l) {
  const key = ["speed", l.mode, l.count, l.thick, l.inner, l.jitter, l.angle, l.color, l.seed, Math.round(l.w), Math.round(l.h)].join("|");
  return artCache(key, l.w, l.h, (g, w, h) => {
    const r = rng(l.seed);
    g.fillStyle = l.color;
    if (l.mode === "focus") {         // 集中線: wedges from the edge toward an empty centre
      const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) * 0.6;
      g.beginPath();
      for (let k = 0; k < l.count; k++) {
        const a = r() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const reach = l.inner * (1 + l.jitter * (r() * 1.6 - 0.3));
        const ex = cx + ca * w / 2 * reach, ey = cy + sa * h / 2 * reach;
        const ox = cx + ca * R, oy = cy + sa * R, t = l.thick * (0.35 + r() * 0.9);
        g.moveTo(ox - sa * t, oy + ca * t); g.lineTo(ex, ey); g.lineTo(ox + sa * t, oy - ca * t); g.closePath();
      }
      g.fill();
      return;
    }
    g.translate(w / 2, h / 2); g.rotate((l.angle || 0) * Math.PI / 180);   // 流線: parallel speed lines
    const D = Math.hypot(w, h) / 2;
    g.beginPath();
    for (let k = 0; k < l.count; k++) {
      const y = (r() * 2 - 1) * D, len = D * (0.4 + r() * 1.2) * (1 - l.inner * 0.6), x1 = (r() * 2 - 1) * D * (0.3 + l.jitter);
      const x0 = x1 - len, t = l.thick * (0.15 + r() * 0.6);
      g.moveTo(x0, y); g.lineTo(x1 - len * 0.1, y - t / 2); g.lineTo(x1, y); g.lineTo(x1 - len * 0.1, y + t / 2); g.closePath();
    }
    g.fill();
  }, l.id);
}
/* drawn bubbles: body + tail in the bubble's own (unrotated, centred) frame */
const VSHAPES = [["oval", "Oval (speech)"], ["box", "Rounded box"], ["cloud", "Cloud (thought)"], ["burst", "Burst (shout)"], ["whisper", "Dashed (whisper)"], ["flash", "Flash (inner voice)"]];
function vBody(l) {
  const p = new Path2D(), rx = l.w / 2, ry = l.h / 2;
  if (l.shape === "box") { p.roundRect(-rx, -ry, l.w, l.h, Math.min(l.w, l.h) * 0.14); return p; }
  if (l.shape === "cloud") {
    const n = clamp(Math.round((l.w + l.h) / (Math.min(l.w, l.h) * 0.3)), 9, 24), r = rng(l.seed), pts = [];
    for (let k = 0; k < n; k++) { const a = (k + (r() - 0.5) * 0.3) / n * Math.PI * 2; pts.push([Math.cos(a) * rx * 0.86, Math.sin(a) * ry * 0.86, a]); }
    p.moveTo(pts[0][0], pts[0][1]);
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n], am = (a[2] + (k === n - 1 ? b[2] + Math.PI * 2 : b[2])) / 2, bulge = 1.2 + r() * 0.08;
      p.quadraticCurveTo(Math.cos(am) * rx * bulge, Math.sin(am) * ry * bulge, b[0], b[1]);
    }
    p.closePath(); return p;
  }
  if (l.shape === "burst" || l.shape === "flash") {
    const n = l.spikes || 16, r = rng(l.seed), flash = l.shape === "flash";
    for (let k = 0; k < n * 2; k++) {
      const a = k / (n * 2) * Math.PI * 2, out = k % 2 === 0;
      const f = flash ? (out ? 1 + r() * 0.12 : 0.9) : (out ? 0.98 + r() * 0.3 : 0.74 + r() * 0.06);
      const x = Math.cos(a) * rx * f, y = Math.sin(a) * ry * f;
      k ? p.lineTo(x, y) : p.moveTo(x, y);
    }
    p.closePath(); return p;
  }
  p.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); return p;
}
function vTail(l) {
  if (!l.tail) return [];
  const rx = l.w / 2, ry = l.h / 2, tx = l.tail.x, ty = l.tail.y;
  const th = Math.atan2(ty / ry, tx / rx);
  if (l.shape === "cloud") {           // thought bubbles trail little circles
    const bx = Math.cos(th) * rx * 0.9, by = Math.sin(th) * ry * 0.9, out = [];
    for (let i = 1; i <= 3; i++) {
      const t = i / 3.2, rr = Math.min(l.w, l.h) * (0.1 - i * 0.022);
      const c = new Path2D(); c.ellipse(bx + (tx - bx) * t, by + (ty - by) * t, rr * 1.3, rr, 0, 0, Math.PI * 2); out.push(c);
    }
    return out;
  }
  const d = (l.tailW || 0.22) * 1.1, k = l.shape === "box" ? 0.8 : ["burst", "flash"].includes(l.shape) ? 0.62 : 0.86;
  const b1 = [Math.cos(th - d) * rx * k, Math.sin(th - d) * ry * k], b2 = [Math.cos(th + d) * rx * k, Math.sin(th + d) * ry * k];
  const mx = (b1[0] + b2[0]) / 2, my = (b1[1] + b2[1]) / 2, bend = 0.18;
  const nx = -(ty - my) * bend, ny = (tx - mx) * bend;
  const p = new Path2D();
  p.moveTo(b1[0], b1[1]);
  p.quadraticCurveTo((b1[0] + tx) / 2 + nx, (b1[1] + ty) / 2 + ny, tx, ty);
  p.quadraticCurveTo((b2[0] + tx) / 2 + nx * 0.6, (b2[1] + ty) / 2 + ny * 0.6, b2[0], b2[1]);
  p.closePath();
  return [p];
}
const VTEXT = { oval: [0.72, 0.66], box: [0.86, 0.8], cloud: [0.64, 0.58], burst: [0.56, 0.5], whisper: [0.72, 0.66], flash: [0.66, 0.6] };
function drawVBubble(ctx, l, maxFont) {
  const body = vBody(l), tails = vTail(l);
  ctx.lineJoin = "round"; ctx.lineWidth = l.strokeW; ctx.strokeStyle = l.stroke; ctx.fillStyle = l.fill;
  if (l.shape === "whisper") ctx.setLineDash([l.strokeW * 3, l.strokeW * 2.2]);
  if (l.strokeW > 0) { for (const t of tails) ctx.stroke(t); ctx.stroke(body); }
  for (const t of tails) ctx.fill(t);
  ctx.fill(body);
  if (l.shape === "cloud" && l.strokeW > 0) for (const t of tails) ctx.stroke(t);
  ctx.setLineDash([]);
  const [fw, fh] = VTEXT[l.shape] || VTEXT.oval;
  const light = (() => { const c = l.fill.replace("#", ""); const v = parseInt(c.length === 3 ? c.split("").map(x => x + x).join("") : c, 16);
    return ((v >> 16 & 255) * 0.3 + (v >> 8 & 255) * 0.59 + (v & 255) * 0.11) > 110; })();
  drawText(ctx, { ...l, strokeWidth: 0 }, 0, 0, l.w * fw, l.h * fh, maxFont, l.color === "auto" ? (light ? "#111111" : "#ffffff") : l.color);
}
function drawFlipped(ctx, im, r, flip) {
  if (!flip) return ctx.drawImage(im, r.x, r.y, r.w, r.h);
  ctx.save(); ctx.translate(r.x + r.w, r.y); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, r.w, r.h); ctx.restore();
}
function drawPage(ctx, pg, opt = {}) {
  ctx.fillStyle = pg.bg || "#fff";
  ctx.fillRect(0, 0, W(), H());
  for (const l of pg.layers) drawLayer(ctx, l, { ...opt, ghost: opt.ghostId === l.id });
}

/* ================================================================ canvas view */
const cv = $("#canvas"), ctx = cv.getContext("2d"), stage = $("#stage");
/* Rendering: the page is painted once into an offscreen bitmap (PC) at screen resolution and
   blitted, so panning, zooming and overlays cost one drawImage. While a layer is dragged, the layers
   under and over it are frozen into two bitmaps and only the moving layer is painted each frame.
   Above ~4k px the cache stops growing; once the view settles the page is painted directly (sharp). */
let drawQueued = false;
const PC = { c: document.createElement("canvas"), cs: 0, key: "", dirty: true };
let DC = null;  // drag cache {below, above, from, to, key}
const MAX_CACHE = 4096;
function requestDraw() { PC.dirty = true; if (!S.drag) DC = null; requestView(); }
function requestView() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }
let settleT = null;
function interacting() { S.busy = true; clearTimeout(settleT); settleT = setTimeout(() => { S.busy = false; requestView(); }, 160); }
function resize() {
  const r = stage.getBoundingClientRect(), d = devicePixelRatio || 1;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  if (S.needFit && S.doc) fitView();
  requestDraw();
}
function fitView() {
  const r = stage.getBoundingClientRect(), pad = Math.min(40, r.width / 10, r.height / 10);
  if (r.width < 50 || r.height < 50) { S.needFit = true; return; }
  S.needFit = false;
  const s = Math.min((r.width - pad * 2) / W(), (r.height - pad * 2) / H());
  if (!(s > 0)) { S.needFit = true; return; }
  S.view = { s, tx: (r.width - W() * s) / 2, ty: (r.height - H() * s) / 2 };
  requestDraw(); updateZoom();
}
function zoomAt(f, sx, sy) {
  const v = S.view, ns = clamp(v.s * f, 0.03, 8);
  v.tx = sx - (sx - v.tx) * ns / v.s; v.ty = sy - (sy - v.ty) * ns / v.s; v.s = ns;
  interacting(); requestView(); updateZoom(); placeInline();
}
const toPage = (sx, sy) => ({ x: (sx - S.view.tx) / S.view.s, y: (sy - S.view.ty) / S.view.s });
const toScreen = (x, y) => ({ x: x * S.view.s + S.view.tx, y: y * S.view.s + S.view.ty });
function updateZoom() { $("#st-zoom").textContent = Math.round(S.view.s * 100) + "%"; }

function cacheScale() { return Math.min(S.view.s * (devicePixelRatio || 1), MAX_CACHE / Math.max(W(), H())); }
function paintCache(target, cs, from, to) {           // layers [from, to) of this page at cs device px per page px
  target.width = Math.ceil(W() * cs); target.height = Math.ceil(H() * cs);
  const g = target.getContext("2d");
  g.setTransform(cs, 0, 0, cs, 0, 0);
  if (from === 0) { g.fillStyle = page().bg || "#fff"; g.fillRect(0, 0, W(), H()); }
  const ls = layers();
  for (let i = from; i < to; i++) drawLayer(g, ls[i], { rs: cs });
  return target;
}
function liveRange() {                                  // contiguous layer range that moves with the drag
  const d = S.drag, ls = layers();
  const ids = new Set([d.layer.id, ...(d.kids || []).map(k => k.q.id)]);
  let a = ls.length, b = -1;
  ls.forEach((l, i) => { if (ids.has(l.id)) { a = Math.min(a, i); b = Math.max(b, i); } });
  return [a, b + 1];
}
function draw() {
  drawQueued = false;
  if (!S.doc) return;
  if (!(S.view.s > 0) || !isFinite(S.view.tx + S.view.ty)) { S.view = { s: 0.25, tx: 0, ty: 0 }; fitView(); }
  const d = devicePixelRatio || 1, v = S.view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#151517"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(d * v.s, 0, 0, d * v.s, d * v.tx, d * v.ty);
  ctx.shadowColor = "#0009"; ctx.shadowBlur = 12 * d;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W(), H());
  ctx.shadowBlur = 0;
  // page content clipped to the paper (bubbles may hang over panel borders, not off the page)
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W(), H()); ctx.clip();
  const ad = S.adjust && layers().find(l => l.id === S.adjust);
  const cs = cacheScale(), dragging = S.drag?.layer && !S.drag.pan;
  if (dragging) {
    const [from, to] = liveRange(), key = `${page().id}|${from}|${to}|${layers().length}|${cs}`;
    if (!DC || DC.key !== key) {
      DC = { key, from, to, below: paintCache(DC?.below || document.createElement("canvas"), cs, 0, from),
             above: paintCache(DC?.above || document.createElement("canvas"), cs, to, layers().length) };
    }
    const ls = layers();
    ctx.drawImage(DC.below, 0, 0, W(), H());
    for (let i = DC.from; i < DC.to; i++) drawLayer(ctx, ls[i], { rs: v.s * d });
    ctx.drawImage(DC.above, 0, 0, W(), H());
  } else if (!S.busy && v.s * d > cs * 1.01) {
    drawPage(ctx, page(), { rs: v.s * d });            // zoomed past the cache: paint directly once settled
  } else {
    const key = `${page().id}|${cs}`;
    if (PC.dirty || PC.key !== key) {
      if (!S.busy || !PC.key.startsWith(page().id) || PC.dirty) { paintCache(PC.c, cs, 0, layers().length); PC.key = key; PC.dirty = false; }
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(PC.c, 0, 0, W(), H());
  }
  ctx.restore();
  if (ad) { // image outside the panel, faded, so you can see what you are cropping
    const rr = ad.image && imageRect(ad), im = rr && imgFor(ad.image.ref, rr.w * v.s * d);
    if (im) {
      ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 2e5); ctx.rect(ad.x, ad.y, ad.w, ad.h); ctx.clip("evenodd");
      ctx.globalAlpha = 0.35; drawFlipped(ctx, im, rr, ad.image.flip); ctx.restore();
    }
    ctx.save(); ctx.setLineDash([12 / v.s, 8 / v.s]); ctx.strokeStyle = "#ff4f7b"; ctx.lineWidth = 2 / v.s;
    ctx.strokeRect(ad.x, ad.y, ad.w, ad.h); ctx.restore();
  }
  // overlays
  const px = 1 / v.s;
  if (S.showOrder) drawPanelOrder(px);
  if (S.showPrint) drawPrintGuides(px);
  if (S.drag?.creating) {
    const c = S.drag.creating;
    ctx.save(); ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = "#4c8dff"; ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(c.x, c.y, c.w, c.h); ctx.restore();
  }
  for (const g of S.guides) {
    ctx.strokeStyle = "#ff3df2"; ctx.lineWidth = px; ctx.beginPath();
    if (g.x != null) { ctx.moveTo(g.x, -2000); ctx.lineTo(g.x, H() + 2000); } else { ctx.moveTo(-2000, g.y); ctx.lineTo(W() + 2000, g.y); }
    ctx.stroke();
  }
  const s = selL();
  if (s && !ad) drawSelection(s, px);
}
/* print guides on the 1800x2700 page (B5-ish tankobon at 350 dpi): trim 3 mm in from the edge (the bleed),
   safe area 5 mm inside the trim. Art that must survive the cut stays inside the green line. */
function drawPrintGuides(px) {
  const mm = W() / 182 * 1, bleed = 3 * mm, safe = bleed + 5 * mm;
  ctx.save(); ctx.lineWidth = 1.5 * px; ctx.setLineDash([10 * px, 6 * px]);
  ctx.strokeStyle = "#ff4f7b"; ctx.strokeRect(bleed, bleed, W() - 2 * bleed, H() - 2 * bleed);
  ctx.strokeStyle = "#3ccf8e"; ctx.strokeRect(safe, safe, W() - 2 * safe, H() - 2 * safe);
  ctx.setLineDash([]); ctx.fillStyle = "#ff4f7b"; ctx.font = `${12 * px}px sans-serif`;
  ctx.fillText("trim", bleed + 4 * px, bleed - 4 * px); ctx.fillStyle = "#3ccf8e"; ctx.fillText("safe area", safe + 4 * px, safe + 14 * px);
  ctx.restore();
}
function drawPanelOrder(px) {
  const order = panelOrder(layers());
  ctx.save();
  order.forEach((l, i) => {
    const r = 22 * px, x = l.x + 14 * px + r, y = l.y + 14 * px + r;
    ctx.globalAlpha = 0.85; ctx.fillStyle = "#ff4f7b"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.font = `700 ${22 * px}px -apple-system, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(i + 1, x, y + px);
  });
  ctx.restore();
}
function panelOrder(ls) {  // same rule as mp.page.reading_order
  const ps = ls.filter(l => l.type === "panel" && l.visible).sort((a, b) => a.y - b.y);
  const rows = [];
  for (const p of ps) {
    const row = rows.find(r => p.y < r[0].y + Math.min(...r.map(q => q.h)) * 0.5);
    row ? row.push(p) : rows.push([p]);
  }
  const rtl = S.doc.reading !== "ltr";
  return rows.flatMap(r => r.sort((a, b) => rtl ? (b.x + b.w) - (a.x + a.w) : a.x - b.x));
}
function corners(l) {
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2, a = (l.rotate || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const P = (dx, dy) => ({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c });
  return { P, cx, cy, a };
}
const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
function drawSelection(l, px) {
  const { P } = corners(l), hw = l.w / 2, hh = l.h / 2;
  const pts = [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
  ctx.save();
  ctx.strokeStyle = l.locked ? "#f5b84b" : "#4c8dff"; ctx.lineWidth = 1.5 * px;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
  if (!l.locked) {
    for (const [hx, hy] of HANDLES) {
      const p = P(hx * hw, hy * hh), r = 5 * px;
      ctx.fillStyle = "#fff"; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    if (l.type === "vbubble" && l.tail) {
      const t = P(l.tail.x, l.tail.y);
      ctx.fillStyle = "#ff4f7b"; ctx.beginPath(); ctx.arc(t.x, t.y, 7 * px, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.strokeStyle = "#4c8dff";
    }
    if (l.type !== "panel") {
      const t = P(0, -hh), rp = P(0, -hh - 34 * px);
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
      ctx.fillStyle = "#4c8dff"; ctx.beginPath(); ctx.arc(rp.x, rp.y, 6 * px, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

/* ================================================================ hit testing */
function local(l, p) {
  const { cx, cy, a } = corners(l), dx = p.x - cx, dy = p.y - cy, c = Math.cos(-a), s = Math.sin(-a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
function hitLayer(p, pred = () => true) {
  const ls = layers();
  for (let i = ls.length - 1; i >= 0; i--) {
    const l = ls[i];
    if (!l.visible || !pred(l)) continue;
    const q = local(l, p);
    if (Math.abs(q.x) <= l.w / 2 && Math.abs(q.y) <= l.h / 2) return l;
  }
  return null;
}
function hitHandle(l, p) {
  if (!l || l.locked) return null;
  const px = 1 / S.view.s, q = local(l, p), hw = l.w / 2, hh = l.h / 2;
  if (l.type === "vbubble" && l.tail && Math.hypot(q.x - l.tail.x, q.y - l.tail.y) < 11 * px) return { tail: true };
  if (l.type !== "panel" && Math.hypot(q.x, q.y + hh + 34 * px) < 9 * px) return { rot: true };
  for (const [hx, hy] of HANDLES) if (Math.abs(q.x - hx * hw) < 8 * px && Math.abs(q.y - hy * hh) < 8 * px) return { hx, hy };
  return null;
}

/* ================================================================ snapping */
function snapBox(box, moving, thr) {
  const xs = [0, W() / 2, W()], ys = [0, H() / 2, H()];
  for (const l of layers()) {
    if (l.id === moving || !l.visible || l.rotate) continue;
    xs.push(l.x, l.x + l.w, l.x + l.w / 2); ys.push(l.y, l.y + l.h, l.y + l.h / 2);
    if (l.type === "panel") { const g = 30; xs.push(l.x - g - l.border, l.x + l.w + g + l.border); ys.push(l.y - g - l.border, l.y + l.h + g + l.border); }
  }
  const guides = [];
  const best = (cands, targets) => {
    let b = null;
    for (const [v, off] of cands) for (const t of targets) { const d = t - v; if (Math.abs(d) < thr && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, t }; }
    return b;
  };
  const bx = best([[box.x, 0], [box.x + box.w / 2, 0], [box.x + box.w, 0]], xs);
  const by = best([[box.y, 0], [box.y + box.h / 2, 0], [box.y + box.h, 0]], ys);
  if (bx) { box.x += bx.d; guides.push({ x: bx.t }); }
  if (by) { box.y += by.d; guides.push({ y: by.t }); }
  return guides;
}

/* ================================================================ pointer */
const DRAG_TOOLS = { panel: 1, caption: 1, text: 1, sfx: 1, bubble: 1, vbubble: 1, tone: 1, speed: 1 };
let spaceDown = false;
cv.addEventListener("pointerdown", e => {
  if (!S.doc) return;
  hideInline(true);
  try { cv.setPointerCapture(e.pointerId); } catch { }
  const r = cv.getBoundingClientRect(), sp = { x: e.clientX - r.left, y: e.clientY - r.top }, p = toPage(sp.x, sp.y);
  if (e.button === 1 || spaceDown || S.tool === "hand") {
    S.drag = { pan: true, sx: sp.x, sy: sp.y, tx: S.view.tx, ty: S.view.ty }; stage.classList.add("grabbing"); return;
  }
  if (S.adjust) {
    const pl = layers().find(l => l.id === S.adjust);
    if (pl && pl.image && hitLayer(p, l => l.id === pl.id)) {
      S.drag = { adjust: pl, layer: pl, p0: p, f0: [...(pl.image.focus || [0.5, 0.5])] }; return;
    }
    exitAdjust();
  }
  if (S.tool === "move") {
    const cur = selL(), hh = hitHandle(cur, p);
    if (hh) {
      S.drag = { layer: cur, l0: deep(cur), p0: p, kids: clipKids(cur), ...(hh.tail ? { tail: true } : hh.rot ? { rot: true } : { hx: hh.hx, hy: hh.hy }) }; return;
    }
    const hit = (e.altKey || e.metaKey) ? hitLayer(p, l => l.type === "panel") : hitLayer(p);
    S.sel = hit ? hit.id : null;
    refreshPanels();
    if (hit && !hit.locked) S.drag = { layer: hit, l0: deep(hit), p0: p, move: true, dup: e.altKey && !e.metaKey, kids: clipKids(hit) };
    requestView(); return;
  }
  if (DRAG_TOOLS[S.tool]) { S.drag = { creating: { x: p.x, y: p.y, w: 0, h: 0 }, p0: p, tool: S.tool }; requestDraw(); }
});
cv.addEventListener("pointermove", e => {
  const r = cv.getBoundingClientRect(), sp = { x: e.clientX - r.left, y: e.clientY - r.top }, p = toPage(sp.x, sp.y);
  $("#st-pos").textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
  const d = S.drag;
  if (!d) { hoverCursor(p); return; }
  if (d.pan) { S.view.tx = d.tx + sp.x - d.sx; S.view.ty = d.ty + sp.y - d.sy; interacting(); requestView(); return; }
  if (d.adjust) {
    const l = d.adjust;
    const rr = imageRect(l), dx = p.x - d.p0.x, dy = p.y - d.p0.y, fl = l.image.flip ? -1 : 1;
    const hx = l.w / 2 / rr.w, hy = l.h / 2 / rr.h;
    l.image.focus = [clamp(d.f0[0] - fl * dx / rr.w, hx, 1 - hx), clamp(d.f0[1] - dy / rr.h, hy, 1 - hy)].map(v => +v.toFixed(4));
    if (l.image.fit === "contain") l.image.focus = d.f0;
    requestDraw(); return;
  }
  if (d.creating) {
    const c = d.creating;
    c.x = Math.min(d.p0.x, p.x); c.y = Math.min(d.p0.y, p.y); c.w = Math.abs(p.x - d.p0.x); c.h = Math.abs(p.y - d.p0.y);
    S.guides = d.tool === "panel" && S.showGuides ? snapEdges(c) : [];
    requestDraw(); return;
  }
  const l = d.layer;
  if (d.dup && !d.duped) { d.duped = true; const c = deep(d.l0); c.id = uid(); layers().splice(layers().indexOf(l), 0, c); }
  if (d.move) {
    const box = { x: d.l0.x + p.x - d.p0.x, y: d.l0.y + p.y - d.p0.y, w: l.w, h: l.h };
    if (e.shiftKey) { if (Math.abs(p.x - d.p0.x) > Math.abs(p.y - d.p0.y)) box.y = d.l0.y; else box.x = d.l0.x; }
    S.guides = S.showGuides && !e.ctrlKey ? snapBox(box, l.id, 7 / S.view.s) : [];
    l.x = box.x; l.y = box.y;
    followPanel(d, l);
  } else if (d.tail) {
    const q = local(l, p); l.tail = { x: +q.x.toFixed(1), y: +q.y.toFixed(1) };
  } else if (d.rot) {
    const { cx, cy } = corners(d.l0);
    let a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    a = ((a + 180) % 360 + 360) % 360 - 180;
    l.rotate = +a.toFixed(1);
  } else {
    resizeLayer(l, d, p, e.shiftKey);
    followPanel(d, l);
  }
  requestDraw(); refreshProps(true);
});
/* tones and lines clipped to a panel move and stretch with it */
function clipKids(l) {
  if (l.type !== "panel") return [];
  return layers().filter(q => q.clip === l.id).map(q => ({ q, x: q.x, y: q.y, w: q.w, h: q.h }));
}
function followPanel(d, l) {
  if (!d.kids?.length || d.dup) return;
  const L = d.l0, sx = l.w / L.w, sy = l.h / L.h;
  for (const k of d.kids) { k.q.x = l.x + (k.x - L.x) * sx; k.q.y = l.y + (k.y - L.y) * sy; k.q.w = k.w * sx; k.q.h = k.h * sy; }
}
function snapEdges(c) {
  const box = { ...c }, g = snapBox(box, null, 7 / S.view.s);
  return g;
}
function resizeLayer(l, d, p, shift) {
  const L = d.l0, { a } = corners(L), c = Math.cos(-a), s = Math.sin(-a);
  const cx0 = L.x + L.w / 2, cy0 = L.y + L.h / 2;
  const qx = (p.x - cx0) * c - (p.y - cy0) * s, qy = (p.x - cx0) * s + (p.y - cy0) * c;
  let w = d.hx ? Math.max(12, d.hx * qx + L.w / 2) : L.w;
  let hh = d.hy ? Math.max(12, d.hy * qy + L.h / 2) : L.h;
  const keep = (l.type === "bubble" || l.type === "image") !== shift;
  if (keep && d.hx && d.hy) { const k = Math.max(w / L.w, hh / L.h); w = L.w * k; hh = L.h * k; }
  else if (keep && (l.type === "bubble" || l.type === "image")) {
    if (d.hx) hh = L.h * w / L.w; else w = L.w * hh / L.h;
  }
  const lx = d.hx ? d.hx * (w - L.w) / 2 : 0, ly = d.hy ? d.hy * (hh - L.h) / 2 : 0;
  const ca = Math.cos(a), sa = Math.sin(a);
  const ncx = cx0 + lx * ca - ly * sa, ncy = cy0 + lx * sa + ly * ca;
  l.w = w; l.h = hh; l.x = ncx - w / 2; l.y = ncy - hh / 2;
  if (L.tail) l.tail = { x: L.tail.x * w / L.w, y: L.tail.y * hh / L.h };
  if (l.type === "panel" && S.showGuides && !l.rotate) {
    const box = { x: l.x, y: l.y, w: l.w, h: l.h };
    S.guides = [];
    // snap only the moving edges
    const thr = 7 / S.view.s, snapV = (v, ts) => { for (const t of ts) if (Math.abs(t - v) < thr) return t; return null; };
    const xs = [0, W(), ...layers().filter(o => o.id !== l.id && o.type === "panel").flatMap(o => [o.x, o.x + o.w, o.x - 30 - o.border, o.x + o.w + 30 + o.border])];
    const ys = [0, H(), ...layers().filter(o => o.id !== l.id && o.type === "panel").flatMap(o => [o.y, o.y + o.h, o.y - 30 - o.border, o.y + o.h + 30 + o.border])];
    if (d.hx === 1) { const t = snapV(box.x + box.w, xs); if (t != null) { l.w = t - l.x; S.guides.push({ x: t }); } }
    if (d.hx === -1) { const t = snapV(box.x, xs); if (t != null) { l.w += l.x - t; l.x = t; S.guides.push({ x: t }); } }
    if (d.hy === 1) { const t = snapV(box.y + box.h, ys); if (t != null) { l.h = t - l.y; S.guides.push({ y: t }); } }
    if (d.hy === -1) { const t = snapV(box.y, ys); if (t != null) { l.h += l.y - t; l.y = t; S.guides.push({ y: t }); } }
  }
}
cv.addEventListener("pointerup", e => {
  const d = S.drag; S.drag = null; S.guides = []; DC = null; stage.classList.remove("grabbing");
  if (d && !d.pan) requestDraw();
  if (!d) return;
  if (d.pan) return;
  if (d.adjust) { commit("Image moved"); return; }
  if (d.creating) {
    const c = d.creating, small = c.w < 12 && c.h < 12;
    createAt(d.tool, c, small);
    return;
  }
  const l = d.layer;
  if (JSON.stringify(l) !== JSON.stringify(d.l0) || d.duped) commit(d.duped ? "Duplicated" : d.move ? "Moved" : d.tail ? "Tail moved" : d.rot ? "Rotated" : "Resized");
  requestDraw();
});
cv.addEventListener("dblclick", e => {
  const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
  const l = hitLayer(p);
  if (!l) return;
  S.sel = l.id;
  if (l.type === "panel") { if (l.image) enterAdjust(l); else { S.libTab = "shots"; renderLibrary(); status("Drag a render from Shots onto the panel"); } }
  else if (["bubble", "caption", "text", "vbubble"].includes(l.type)) showInline(l);
  refreshPanels();
});
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (S.adjust && !e.ctrlKey && !e.metaKey) {
    const l = layers().find(q => q.id === S.adjust);
    if (l?.image) {
      l.image.zoom = +clamp((l.image.zoom || 1) * Math.exp(-e.deltaY * 0.0015), l.image.fit === "contain" ? 0.2 : 1, 8).toFixed(3);
      requestDraw(); refreshProps(true); clearTimeout(S.wheelT); S.wheelT = setTimeout(() => commit("Image zoom"), 400); return;
    }
  }
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
  else { S.view.tx -= e.deltaX; S.view.ty -= e.deltaY; interacting(); requestView(); placeInline(); }
}, { passive: false });
function hoverCursor(p) {
  let c = "default";
  if (spaceDown || S.tool === "hand") c = "grab";
  else if (S.adjust) c = "move";
  else if (S.tool !== "move") c = "crosshair";
  else {
    const hh = hitHandle(selL(), p);
    if (hh) c = hh.rot ? "alias" : (hh.hx && hh.hy ? (hh.hx === hh.hy ? "nwse-resize" : "nesw-resize") : hh.hx ? "ew-resize" : "ns-resize");
    else if (hitLayer(p)) c = "move";
  }
  cv.style.cursor = c;
}

/* ================================================================ creation */
function addLayer(l, at) {
  normalize({ pages: [{ layers: [l] }] });
  l.id = uid();
  const ls = layers();
  if (at != null) ls.splice(at, 0, l); else ls.push(l);
  S.sel = l.id;
  return l;
}
function createAt(tool, c, small) {
  let l;
  if (tool === "panel") {
    if (small) return;
    l = addLayer({ type: "panel", x: c.x, y: c.y, w: c.w, h: c.h, shot: "", image: null }, insertIndexForPanel());
  } else if (tool === "bubble") {
    const m = bubbleMeta(S.bubble), w = small ? 460 : Math.max(c.w, 120), hh = w * m.h / m.w;
    const cx = small ? c.x : c.x + c.w / 2, cy = small ? c.y : c.y + c.h / 2;
    l = addLayer({ type: "bubble", bubble: m.key, x: cx - w / 2, y: cy - hh / 2, w, h: hh, text: "", flip: false });
  } else if (tool === "caption") {
    const w = small ? 520 : c.w, hh = small ? 110 : Math.max(c.h, 40);
    l = addLayer({ type: "caption", x: small ? c.x - w / 2 : c.x, y: small ? c.y - hh / 2 : c.y, w, h: hh, text: "", fill: "#fff0aa" });
  } else if (tool === "text") {
    const w = small ? 420 : c.w, hh = small ? 140 : Math.max(c.h, 40);
    l = addLayer({ type: "text", x: small ? c.x - w / 2 : c.x, y: small ? c.y - hh / 2 : c.y, w, h: hh, text: "", color: "#111111", fontSize: 0, font: "MMComic" });
  } else if (tool === "vbubble") {
    const w = small ? 440 : Math.max(c.w, 120), hh = small ? 300 : Math.max(c.h, 80);
    const cx = small ? c.x : c.x + c.w / 2, cy = small ? c.y : c.y + c.h / 2;
    l = addLayer({ type: "vbubble", shape: S.vshape, x: cx - w / 2, y: cy - hh / 2, w, h: hh, text: "",
      tail: S.vshape === "flash" ? null : { x: -w * 0.18, y: hh * 0.85 }, seed: Math.floor(Math.random() * 1e6),
      font: S.vshape === "burst" ? "Bangers" : "MMComic" });
  } else if (tool === "tone" || tool === "speed") {
    const pl = small ? hitLayer(c, q => q.type === "panel") : null;   // a click fills the panel under it
    const box = pl ? { x: pl.x, y: pl.y, w: pl.w, h: pl.h } : small ? { x: c.x - 300, y: c.y - 300, w: 600, h: 600 } : c;
    if (box.w < 12 || box.h < 12) return;
    const base = { ...box, clip: pl ? pl.id : null, seed: Math.floor(Math.random() * 1e6) };
    const props = tool === "tone" ? { type: "tone", ...TONE_PRESETS[S.tonePreset][1] } : { type: "speed", mode: S.speedMode, ...(S.speedMode === "parallel" ? { count: 120, thick: 10, inner: 0.2, jitter: 0.5 } : {}) };
    l = addLayer({ ...base, ...props }, pl ? layers().indexOf(pl) + 1 : undefined);
    commit("Added " + (tool === "tone" ? "screentone" : "speed lines")); setTool("move"); requestDraw(); return;
  } else if (tool === "sfx") {
    const w = small ? 620 : c.w, hh = small ? 260 : Math.max(c.h, 60);
    l = addLayer({ type: "text", sfx: true, x: small ? c.x - w / 2 : c.x, y: small ? c.y - hh / 2 : c.y, w, h: hh, text: "", rotate: -8,
      color: "#ffffff", stroke: "#000000", strokeWidth: 12, font: "Bangers", fontSize: 0 });
  }
  commit("Added " + (l.type === "text" && l.sfx ? "SFX" : l.type === "vbubble" ? "bubble" : l.type));
  setTool("move");
  requestDraw();
  if (l.type !== "panel") showInline(l);
}
function insertIndexForPanel() { // panels stay under the lettering
  const ls = layers(); let i = 0;
  ls.forEach((l, k) => { if (l.type === "panel") i = k + 1; });
  return i;
}
function addImageLayer(ref, iw, ih, at, multiply) {
  const k = Math.min(1, 900 / Math.max(iw, ih)), w = iw * k, hh = ih * k;
  const cx = at ? at.x : W() / 2, cy = at ? at.y : H() / 2;
  const l = addLayer({ type: "image", ref, iw, ih, x: cx - w / 2, y: cy - hh / 2, w, h: hh, blend: multiply ? "multiply" : "source-over" });
  commit("Added image"); requestDraw(); return l;
}
function setPanelImage(l, ref, shot) {
  const id = l.id;
  const im = new Image();   // the smallest pyramid level is enough for the aspect ratio, and primes the cache
  im.onload = () => {
    const L = S.doc.pages.flatMap(p => p.layers).find(q => q.id === id); // undo may have replaced the object
    if (!L) return;
    L.image = { ref, iw: im.naturalWidth, ih: im.naturalHeight, fit: "cover", focus: [0.5, 0.3], zoom: 1, flip: L.image?.flip || false };
    if (shot) L.shot = shot;
    IMG.set(ref + "|256", im);
    commit("Panel image set"); requestDraw(); refreshProps();
  };
  im.src = `/img?ref=${encodeURIComponent(ref)}&w=256`;
}

/* ================================================================ inline text editing */
const ie = $("#inlineedit");
let ieLayer = null, ieShownAt = 0, ieOrig = "";
function showInline(l) {
  if (ieLayer && ieLayer !== l) hideInline(true);
  ieLayer = l; ieShownAt = performance.now(); ieOrig = l.text || ""; ie.value = l.text || ""; ie.style.display = "block"; placeInline(); ie.focus(); ie.select();
}
function placeInline() {
  if (!ieLayer) return;
  const l = ieLayer, a = toScreen(l.x, l.y), w = Math.max(160, l.w * S.view.s), hh = Math.max(64, Math.min(l.h * S.view.s, 220));
  Object.assign(ie.style, { left: a.x + (l.w * S.view.s - w) / 2 + "px", top: a.y + (l.h * S.view.s - hh) / 2 + "px", width: w + "px", height: hh + "px",
    fontSize: clamp(28 * S.view.s * 1.6, 13, 26) + "px" });
}
function hideInline(save) {
  if (!ieLayer) return;
  const l = ieLayer; ieLayer = null; ie.style.display = "none";
  if (document.activeElement === ie) ie.blur();          // hand the keyboard back to the shortcuts
  l.text = save ? ie.value : ieOrig;
  if (l.text !== ieOrig) commit("Text edited"); else refreshPanels();
  requestDraw();
}
ie.addEventListener("input", () => { if (ieLayer) { ieLayer.text = ie.value; requestDraw(); } });
ie.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); hideInline(true); }
});
ie.addEventListener("blur", () => {
  if (ieLayer && performance.now() - ieShownAt < 400) { setTimeout(() => ie.focus(), 0); return; } // the creating click's tail
  hideInline(true);
});

/* ================================================================ image adjust (panel crop) */
function enterAdjust(l) { S.adjust = l.id; S.sel = l.id; status("Drag to reposition the render, scroll to zoom, Esc when done"); requestDraw(); }
function exitAdjust() { S.adjust = null; status(""); requestDraw(); }

/* ================================================================ tools & keys */
const ICON = {
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3l13 7-6 1.5L9 18z" fill="currentColor"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-.5A6.5 6.5 0 015 17.6L3.4 14a1.6 1.6 0 012.7-1.6L8 15"/></svg>',
  panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="10"/><rect x="13" y="3" width="8" height="6"/><rect x="13" y="11" width="8" height="10"/><rect x="3" y="15" width="8" height="6"/></svg>',
  bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4c5 0 9 3 9 6.8s-4 6.7-9 6.7c-.9 0-1.8-.1-2.6-.3L5 20l1.1-4C4.2 14.8 3 12.9 3 10.8 3 7 7 4 12 4z"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5h14M12 5v15M9 20h6"/></svg>',
  sfx: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 5.6 5.8-2-2.8 5.4L22 14l-6 .8.6 6-4.6-3.9L7.4 21l.6-6-6-1 4.8-3L4 5.6l5.8 2z"/></svg>',
  caption: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 12h10"/></svg>',
  vbubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="13" cy="9.5" rx="8.5" ry="6"/><path d="M8 14l-4 7 8-5.5"/><circle cx="21" cy="21" r="1.6" fill="#ff4f7b" stroke="none"/></svg>',
  tone: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="5" r="1.2"/><circle cx="10" cy="5" r="1.2"/><circle cx="15" cy="5" r="1.4"/><circle cx="20" cy="5" r="1.6"/><circle cx="7.5" cy="9.5" r="1.4"/><circle cx="12.5" cy="9.5" r="1.6"/><circle cx="17.5" cy="9.5" r="1.8"/><circle cx="5" cy="14" r="1.6"/><circle cx="10" cy="14" r="1.8"/><circle cx="15" cy="14" r="2"/><circle cx="20" cy="14" r="2.2"/><circle cx="7.5" cy="18.5" r="2"/><circle cx="12.5" cy="18.5" r="2.2"/><circle cx="17.5" cy="18.5" r="2.4"/></svg>',
  speed: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12L2 3l1-1zM12 12L22 3l-1-1zM12 12L2 21l1 1zM12 12l10 9-1 1zM12 12L12 1h.8zM12 12L1 12.4v-.8zM12 12l11 .4v-.8zM12 12l-.4 11h.8z" opacity=".85"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor"/></svg>',
};
const TOOLS = [["move", "Move / select (V)", "v"], ["hand", "Hand (H, or hold Space)", "h"], null, ["panel", "Panel: drag a frame (P)", "p"],
  ["bubble", "Template bubble (B)", "b"], ["vbubble", "Drawn bubble with a draggable tail (O)", "o"], ["text", "Text (T)", "t"], ["sfx", "Sound effect (S)", "s"],
  ["caption", "Caption box (C)", "c"], null, ["tone", "Screentone: click a panel or drag an area (G)", "g"], ["speed", "Speed / focus lines: click a panel or drag (L)", "l"]];
const TONE_PRESETS = [
  ["Dots 30%", { pattern: "dots", size: 10, density: 0.3, angle: 45, fade: "none" }],
  ["Dots 60%", { pattern: "dots", size: 10, density: 0.6, angle: 45, fade: "none" }],
  ["Gradient down", { pattern: "dots", size: 12, density: 0.75, angle: 45, fade: "down" }],
  ["Gradient up", { pattern: "dots", size: 12, density: 0.75, angle: 45, fade: "up" }],
  ["Vignette", { pattern: "dots", size: 12, density: 0.85, angle: 45, fade: "edges" }],
  ["Lines", { pattern: "lines", size: 9, density: 0.35, angle: 0, fade: "none" }],
  ["Diagonal lines", { pattern: "lines", size: 10, density: 0.3, angle: 45, fade: "none" }],
  ["Crosshatch", { pattern: "cross", size: 12, density: 0.22, angle: 45, fade: "none" }],
  ["Sand / noise", { pattern: "noise", size: 10, density: 0.5, angle: 0, fade: "none" }],
  ["Flat grey", { pattern: "solid", size: 4, density: 0.25, angle: 0, fade: "none" }],
  ["Night (dark)", { pattern: "dots", size: 8, density: 0.9, angle: 45, fade: "none" }],
];
function buildToolbar() {
  const tb = $("#toolbar"); tb.innerHTML = "";
  for (const t of TOOLS) {
    if (!t) { tb.append(h("div", { class: "tsep" })); continue; }
    const b = h("button", { title: t[1].replace(/ \([A-Z]\)$/, "") + " (" + t[2].toUpperCase() + ")", "data-tool": t[0], onclick: () => setTool(t[0]) }); b.innerHTML = ICON[t[0]]; tb.append(b);
  }
  tb.append(h("div", { class: "spacer" }), h("button", { title: "Keyboard shortcuts (?)", onclick: shortcutSheet, style: "font-size:13px;font-weight:700" }, "?"));
}
function setTool(t) {
  if (t === "bubble" && !S.cat?.bubbles?.length) { t = "vbubble"; status("No bubble templates installed: using drawn bubbles"); }
  S.tool = t; if (S.adjust) exitAdjust();
  $$("#toolbar button").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  stage.classList.toggle("hand", t === "hand");
  renderOptions();
}
const inField = e => ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable;
const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/* One table drives the key handler, the menus' hints and the cheat sheet (press ?).
   Combos: mod = ⌘ on Mac / Ctrl elsewhere; keys are physical (e.code), so Shift/Alt variants still match. */
const SHORTCUTS = [
  // tools
  ["Tools", "v", "Move / select", () => setTool("move")],
  ["Tools", "h", "Hand (or hold Space)", () => setTool("hand")],
  ["Tools", "p", "Panel frame", () => setTool("panel")],
  ["Tools", "b", "Template bubble", () => setTool("bubble")],
  ["Tools", "o", "Drawn bubble (tail)", () => setTool("vbubble")],
  ["Tools", "t", "Text", () => setTool("text")],
  ["Tools", "s", "Sound effect", () => setTool("sfx")],
  ["Tools", "c", "Caption box", () => setTool("caption")],
  ["Tools", "g", "Screentone", () => setTool("tone")],
  ["Tools", "l", "Speed / focus lines", () => setTool("speed")],
  // file
  ["File", "mod+n", "New project", () => newProject()],
  ["File", "mod+o", "Open project", () => openDialog(), true],
  ["File", "mod+s", "Save", () => save(), true],
  ["File", "mod+shift+s", "Save as", () => save(true), true],
  ["File", "mod+i", "Import page script", () => importDialog()],
  ["File", "mod+e", "Export this page", () => exportPages("one"), true],
  ["File", "mod+shift+e", "Export all pages + PDF", () => exportPages("all"), true],
  // edit
  ["Edit", "mod+z", "Undo", () => undo()],
  ["Edit", "mod+shift+z", "Redo", () => redo()],
  ["Edit", "mod+y", "Redo", () => redo()],
  ["Edit", "mod+c", "Copy layer", () => act.copy()],
  ["Edit", "mod+x", "Cut layer", () => act.cut()],
  ["Edit", "mod+v", "Paste layer (works across pages)", () => act.paste()],
  ["Edit", "mod+d", "Duplicate layer", () => act.duplicate()],
  ["Edit", "mod+j", "Duplicate layer", () => act.duplicate()],
  ["Edit", "delete", "Delete layer", () => act.remove()],
  ["Edit", "backspace", "Delete layer", () => act.remove()],
  ["Edit", "escape", "Deselect / leave mode", () => act.escape()],
  ["Edit", "enter", "Type in bubble / reposition render", () => act.enter()],
  ["Edit", "arrows", "Nudge 1 px (Shift: 10 px)", null],
  // layer
  ["Layer", "]", "Bring forward", () => act.layerUp()],
  ["Layer", "[", "Send backward", () => act.layerDown()],
  ["Layer", "shift+]", "Bring to front", () => act.toFront()],
  ["Layer", "shift+[", "Send to back", () => act.toBack()],
  ["Layer", "alt+]", "Select layer above", () => act.selectStep(1)],
  ["Layer", "alt+[", "Select layer below", () => act.selectStep(-1)],
  ["Layer", "f", "Flip (bubble tail, image, panel render)", () => act.flip()],
  ["Layer", "shift+r", "Reset rotation", () => act.resetRotation()],
  ["Layer", "mod+l", "Lock / unlock", () => act.toggleLock()],
  ["Layer", "mod+shift+h", "Hide / show", () => act.toggleHide()],
  ["Layer", "1", "Opacity 10% … 0 = 100%", null],
  ["Layer", "\\", "Split panel side by side", () => act.split("v")],
  ["Layer", "shift+\\", "Split panel top / bottom", () => act.split("h")],
  ["Layer", "r", "Render the panel's shot on the pod", () => act.renderSel()],
  // page
  ["Page", "pagedown", "Next page", () => gotoPage(S.page + 1)],
  ["Page", ".", "Next page", () => gotoPage(S.page + 1)],
  ["Page", "pageup", "Previous page", () => gotoPage(S.page - 1)],
  ["Page", ",", "Previous page", () => gotoPage(S.page - 1)],
  ["Page", "home", "First page", () => gotoPage(0)],
  ["Page", "end", "Last page", () => gotoPage(S.doc.pages.length - 1)],
  ["Page", "tab", "Whole-book overview", () => toggleOverview()],
  ["Page", "mod+k", "Choose layout", () => layoutDialog()],
  ["Page", "mod+shift+n", "New page", () => pageOps.add()],
  ["Page", "mod+shift+d", "Duplicate page", () => pageOps.dup()],
  ["Page", "mod+shift+backspace", "Delete page", () => pageOps.del()],
  ["Page", "mod+shift+[", "Move page earlier", () => pageOps.left()],
  ["Page", "mod+shift+]", "Move page later", () => pageOps.right()],
  // view
  ["View", "mod+0", "Fit page", () => fitView()],
  ["View", "mod+1", "Actual pixels", () => zoomAt(1 / S.view.s, ...center())],
  ["View", "mod+=", "Zoom in", () => zoomAt(1.25, ...center())],
  ["View", "mod+-", "Zoom out", () => zoomAt(0.8, ...center())],
  ["View", "m", "Show / hide panel order", () => { S.showOrder = !S.showOrder; requestView(); }],
  ["View", ";", "Snapping on / off", () => { S.showGuides = !S.showGuides; renderOptions(); toast("Snapping " + (S.showGuides ? "on" : "off")); }],
  ["View", "space", "Pan while held", null],
  ["View", "mod+;", "Print guides on / off", () => { S.showPrint = !S.showPrint; requestView(); }],
  // pipeline
  ["Pipeline", "mod+u", "Shots (edit, grab, render)", () => shotDialog(selL()?.shot || null)],
  ["Pipeline", "`", "Jobs log", () => toggleJobs()],
  ["Pipeline", "mod+shift+p", "Pose studio", () => setMode(S.mode === "pose" ? "page" : "pose")],
  ["Help", "shift+/", "This cheat sheet", () => shortcutSheet()],
  ["Help", "f1", "This cheat sheet", () => shortcutSheet()],
];
const CODE_KEY = { BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  Backquote: "`", Equal: "=", Minus: "-", NumpadAdd: "=", NumpadSubtract: "-", Space: "space" };
function comboOf(e) {
  let key = CODE_KEY[e.code] || (e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code.startsWith("Digit") ? e.code.slice(5)
    : e.code.startsWith("Numpad") && /\d$/.test(e.code) ? e.code.slice(-1) : e.key.toLowerCase());
  const SHIFTED = { "+": "=", "?": "/", "{": "[", "}": "]", "|": "\\", ":": ";", "<": ",", ">": ".", "~": "`", "_": "-" };
  if (SHIFTED[key]) key = SHIFTED[key];   // when the browser gives no physical code
  return (e.metaKey || e.ctrlKey ? "mod+" : "") + (e.shiftKey ? "shift+" : "") + (e.altKey ? "alt+" : "") + key;
}
const SC_MAP = new Map(SHORTCUTS.filter(r => r[3]).map(r => [r[1], r]));
function keyLabel(combo) {
  const parts = combo.split("+"), key = parts.pop();
  const names = { mod: isMac ? "⌘" : "Ctrl+", shift: isMac ? "⇧" : "Shift+", alt: isMac ? "⌥" : "Alt+" };
  const keys = { escape: "Esc", enter: "↵", backspace: "⌫", delete: "Del", pagedown: "PgDn", pageup: "PgUp", tab: "Tab", space: "Space",
    home: "Home", end: "End", arrows: "← ↑ → ↓", f1: "F1", "=": "+", "/": "/" };
  return parts.map(p => names[p]).join("") + (keys[key] || key.toUpperCase());
}
const sc = label => { const r = SHORTCUTS.find(r => r[2] === label); return r ? keyLabel(r[1]) : ""; };
document.addEventListener("keydown", e => {
  if (S.mode === "pose" && $("#modal").hidden) return poseKey(e);
  const combo = comboOf(e), row = SC_MAP.get(combo);
  const modalOpen = !$("#modal").hidden;
  if (modalOpen || inField(e)) {
    if (e.key === "Escape" && modalOpen) { e.preventDefault(); closeModal(); }
    else if (row?.[4] && !modalOpen) { e.preventDefault(); row[3](); }      // save/export/open still work while typing
    return;
  }
  if (combo === "space" || combo === "shift+space") { if (!spaceDown) { spaceDown = true; stage.classList.add("hand"); } e.preventDefault(); return; }
  if (e.key.startsWith("Arrow") && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const l = selL(); if (!l || l.locked) return; e.preventDefault();
    const n = e.shiftKey ? 10 : 1;
    l.x += e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0; l.y += e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
    for (const q of layers()) if (q.clip === l.id) { q.x += e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0; q.y += e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0; }
    clearTimeout(S.nudgeT); S.nudgeT = setTimeout(() => commit("Nudged"), 300); requestDraw(); refreshProps(true); return;
  }
  if (/^[0-9]$/.test(combo)) {   // Photoshop-style opacity: 1 = 10% … 0 = 100%
    const l = selL(); if (!l) return; e.preventDefault();
    l.opacity = combo === "0" ? 1 : +combo / 10; commit(`Opacity ${Math.round(l.opacity * 100)}%`); requestDraw(); return;
  }
  if (row) { e.preventDefault(); closeMenu(); row[3](); }
});
function shortcutSheet() {
  const box = modal("Keyboard shortcuts", "");
  const groups = {};
  for (const [g, k, label] of SHORTCUTS) {
    const list = (groups[g] ||= []);
    const prev = list.find(x => x.label === label);
    if (prev) prev.keys.push(keyLabel(k)); else list.push({ label, keys: [keyLabel(k)] });
  }
  const grid = h("div", { class: "scgrid" });
  for (const [g, rows] of Object.entries(groups)) grid.append(h("div", { class: "scgroup" }, h("h4", {}, g),
    ...rows.map(r => h("div", { class: "scrow" }, h("span", {}, r.label), h("span", {}, ...r.keys.flatMap((k, i) => [i ? " / " : "", h("kbd", {}, k)]))))));
  $(".mbody", box).append(grid, h("p", { class: "hint" }, "Mouse: drag to move · Alt-drag duplicates · ⌘-click picks the panel under a bubble · Shift locks axis / keeps aspect · " +
    "Ctrl while dragging disables snapping · double-click a panel to reposition its render, a bubble to type · Ctrl/⌘ + scroll zooms."));
}
document.addEventListener("keyup", e => { if (e.key === " ") { spaceDown = false; stage.classList.toggle("hand", S.tool === "hand"); } });

/* ================================================================ actions */
const act = {
  copy() { const l = selL(); if (!l) return; S.clip = deep(l); status("Copied " + layerName(l)); },
  cut() { const l = selL(); if (!l) return; S.clip = deep(l); act.remove(); status("Cut"); },
  paste() {
    if (!S.clip) return;
    const c = deep(S.clip); c.id = uid();
    if (layers().some(q => q.id === S.clip.id)) { c.x += 30; c.y += 30; }   // same page: offset so it is visible
    if (c.clip && !layers().some(q => q.id === c.clip)) c.clip = null;
    if (c.type === "panel") layers().splice(insertIndexForPanel(), 0, c); else layers().push(c);
    S.sel = c.id; S.clip = deep(c); commit("Pasted"); requestDraw();
  },
  escape() {
    if (!$("#overview").hidden) return toggleOverview(false);
    if (!$("#jobsdrawer").hidden && !selL()) return toggleJobs(false);
    if (S.adjust) return exitAdjust();
    if (S.tool !== "move") return setTool("move");
    S.sel = null; refreshPanels(); requestView();
  },
  enter() {
    const l = selL();
    if (l?.type === "panel" && l.image) enterAdjust(l);
    else if (l && ["bubble", "caption", "text", "vbubble"].includes(l.type)) showInline(l);
  },
  selectStep(dir) {
    const ls = layers(); if (!ls.length) return;
    const i = selL() ? ls.indexOf(selL()) : dir > 0 ? -1 : ls.length;
    S.sel = ls[clamp(i + dir, 0, ls.length - 1)].id; refreshPanels(); requestView();
  },
  flip() {
    const l = selL(); if (!l) return;
    if (l.type === "panel") { if (!l.image) return; l.image.flip = !l.image.flip; }
    else if (l.type === "vbubble") { if (!l.tail) return; l.tail = { x: -l.tail.x, y: l.tail.y }; }
    else l.flip = !l.flip;
    commit("Flipped"); requestDraw();
  },
  resetRotation() { const l = selL(); if (!l || !l.rotate) return; l.rotate = 0; commit("Rotation reset"); requestDraw(); },
  toggleLock() { const l = selL(); if (!l) return; l.locked = !l.locked; commit(l.locked ? "Locked" : "Unlocked"); requestView(); },
  toggleHide() { const l = selL(); if (!l) return; l.visible = !l.visible; commit(l.visible ? "Shown" : "Hidden"); requestDraw(); },
  renderSel() { const l = selL(); if (l?.type === "panel" && l.shot) renderShot(l.shot); else toast("Select a panel that has a shot"); },
  remove() {
    const l = selL(); if (!l) return; layers().splice(layers().indexOf(l), 1);
    for (const q of layers()) if (q.clip === l.id) q.clip = null;
    S.sel = null; commit("Deleted"); requestDraw();
  },
  duplicate() {
    const l = selL(); if (!l) return; const c = deep(l); c.id = uid(); if (!c.clip) { c.x += 30; c.y += 30; }
    layers().splice(layers().indexOf(l) + 1, 0, c); S.sel = c.id; commit("Duplicated"); requestDraw();
  },
  layerUp() { const ls = layers(), l = selL(); if (!l) return; const i = ls.indexOf(l); if (i < ls.length - 1) { ls.splice(i, 1); ls.splice(i + 1, 0, l); commit("Moved up"); requestDraw(); } },
  layerDown() { const ls = layers(), l = selL(); if (!l) return; const i = ls.indexOf(l); if (i > 0) { ls.splice(i, 1); ls.splice(i - 1, 0, l); commit("Moved down"); requestDraw(); } },
  toFront() { const ls = layers(), l = selL(); if (!l) return; ls.splice(ls.indexOf(l), 1); ls.push(l); commit("To front"); requestDraw(); },
  toBack() { const ls = layers(), l = selL(); if (!l) return; ls.splice(ls.indexOf(l), 1); ls.unshift(l); commit("To back"); requestDraw(); },
  split(dir) {
    const l = selL(); if (!l || l.type !== "panel") return;
    const g = 30 + l.border, b = deep(l); b.id = uid(); b.image = null; b.shot = "";
    if (dir === "v") { const w = (l.w - g) / 2; l.w = w; b.x = l.x + w + g; b.w = w; }
    else { const hh = (l.h - g) / 2; l.h = hh; b.y = l.y + hh + g; b.h = hh; }
    layers().splice(layers().indexOf(l) + 1, 0, b); commit("Split panel"); requestDraw();
  },
};
document.addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b && act[b.dataset.act]) act[b.dataset.act](); });

/* ================================================================ layouts */
function gridRects(rows, heights, margin = 60, gutter = 30, line = 4) {
  const avH = H() - 2 * margin - gutter * (rows.length - 1), out = [];
  let y = margin;
  rows.forEach((row, i) => {
    const hh = avH * heights[i] / heights.reduce((a, b) => a + b, 0);
    const avW = W() - 2 * margin - gutter * (row.length - 1);
    let x = margin;
    for (const cw of row) { const w = avW * cw / row.reduce((a, b) => a + b, 0); out.push([x + line, y + line, w - 2 * line, hh - 2 * line]); x += w + gutter; }
    y += hh + gutter;
  });
  return out;
}
function applyLayout(rects, label) {
  const ls = layers(), old = panelOrder(ls);
  const keep = ls.filter(l => l.type !== "panel");
  const sx = W() / 1800, sy = H() / 2700;
  const fresh = rects.map(([x, y, w, hh]) => normalize({ pages: [{ layers: [{ type: "panel", x: x * sx, y: y * sy, w: w * sx, h: hh * sy, shot: "", image: null }] }] }).pages[0].layers[0]);
  const order = panelOrder(fresh);
  order.forEach((p, i) => { const o = old[i]; if (o) { p.image = o.image; p.shot = o.shot; p.border = o.border; p.borderColor = o.borderColor; } });
  page().layers = [...fresh, ...keep];
  S.sel = null; commit("Layout " + label); requestDraw(); renderPages();
}
/* classic manga page grids, built in so a page can be laid out with no template pack installed:
   rows of relative widths, then relative row heights */
const PRESET_LAYOUTS = [
  ["Splash", [[1]], [1]], ["Two tiers", [[1], [1]], [1, 1]], ["Three tiers", [[1], [1], [1]], [1, 1, 1]],
  ["4-koma", [[1], [1], [1], [1]], [1, 1, 1, 1]], ["Classic six", [[1, 1], [1, 1], [1, 1]], [1, 1, 1]],
  ["Establishing + 4", [[1], [1, 1], [1, 1]], [1.3, 1, 1]], ["1 · 2 · 1", [[1], [1, 1], [1]], [1, 1.2, 1]],
  ["Action stack", [[2, 1], [1], [1, 2]], [1, 1.4, 1]], ["Dialogue grid", [[1, 1, 1], [1, 1], [1, 1, 1]], [1, 1.2, 1]],
  ["Big reveal", [[1, 1], [1]], [1, 2.2]], ["Tall + stack", [[1], [1, 1, 1]], [2, 1]], ["Nine grid", [[1, 1, 1], [1, 1, 1], [1, 1, 1]], [1, 1, 1]],
];
function presetThumb(rows, hs) {
  const c = document.createElement("canvas"); c.width = 120; c.height = 180;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 120, 180);
  g.strokeStyle = "#111"; g.lineWidth = 2;
  for (const [x, y, w, hh] of gridRects(rows, hs)) g.strokeRect(x / W() * 120, y / H() * 180, w / W() * 120, hh / H() * 180);
  return c;
}
function presetTiles(onPick) {
  const t = h("div", { class: "tiles" });
  for (const [name, rows, hs] of PRESET_LAYOUTS) {
    const ord = S.doc.reading === "rtl" ? rows.map(r => [...r].reverse()) : rows;
    t.append(h("div", { class: "tile page", title: name, onclick: () => onPick(gridRects(ord, hs), name) }, presetThumb(ord, hs), h("div", { class: "cap" }, name)));
  }
  return t;
}
function layoutDialog() {
  const box = modal("Page layout", "");
  const grid = h("div", { class: "layoutgrid" });
  for (const L of S.cat.layouts) {
    grid.append(h("div", { class: "tile page", title: `Template ${L.n}: ${L.rects.length} panels`, onclick: () => { applyLayout(L.rects, "#" + L.n); closeModal(); } },
      h("img", { src: thumb(L.ref, 180), loading: "lazy" }), h("div", { class: "cap" }, `#${L.n} · ${L.rects.length}`)));
  }
  const rowsIn = h("input", { value: "1 | 1 1 | 2 1", style: "flex:1", title: "rows separated by |, relative widths inside a row" });
  const hIn = h("input", { value: "1 1 1", style: "width:120px", title: "relative row heights" });
  const mIn = h("input", { type: "number", value: 60, style: "width:64px" }), gIn = h("input", { type: "number", value: 30, style: "width:64px" });
  $(".mbody", box).append(
    h("div", { class: "row" }, h("label", {}, "Custom grid"), rowsIn, h("span", { class: "hint" }, "heights"), hIn,
      h("span", { class: "hint" }, "margin"), mIn, h("span", { class: "hint" }, "gutter"), gIn,
      h("button", { class: "primary", onclick: () => {
        const rows = rowsIn.value.split("|").map(r => r.trim().split(/\s+/).map(Number).filter(n => n > 0)).filter(r => r.length);
        let hs = hIn.value.trim().split(/\s+/).map(Number).filter(n => n > 0);
        if (hs.length !== rows.length) hs = rows.map(() => 1);
        applyLayout(gridRects(rows, hs, +mIn.value, +gIn.value), "grid"); closeModal();
      } }, "Apply grid")),
    h("p", { class: "hint" }, "Applying a layout replaces this page's panels. Renders already placed move into the new panels in reading order; bubbles and text stay."),
    h("div", { class: "section" }, "Built-in"), presetTiles((r, n) => { applyLayout(r, n); closeModal(); }),
    S.cat.layouts.length ? h("div", { class: "section" }, "Template pack") : null,
    grid);
}

/* ================================================================ panels: properties */
function num(label, l, key, opt = {}) {
  const inp = h("input", { type: "number", value: Math.round((l[key] ?? 0) * (opt.mul || 1) * 100) / 100, step: opt.step || 1,
    onchange: () => { l[key] = +inp.value / (opt.mul || 1); commit(); requestDraw(); } });
  inp.dataset.k = key;
  return h("label", {}, label, inp);
}
function rowOf(label, ...kids) { return h("div", { class: "row" }, h("label", {}, label), ...kids); }
function slider(label, get, set, min, max, step, fmt = v => v) {
  const val = h("span", { class: "val" }, fmt(get()));
  const r = h("input", { type: "range", min, max, step, value: get(),
    oninput: () => { set(+r.value); val.textContent = fmt(+r.value); requestDraw(); }, onchange: () => commit() });
  return rowOf(label, r, val);
}
function check(label, get, set) {
  return h("label", { style: "display:flex;gap:5px;align-items:center;color:var(--muted)" },
    h("input", { type: "checkbox", checked: !!get(), onchange: e => { set(e.target.checked); commit(); requestDraw(); } }), label);
}
function colorRow(label, l, key, allowAuto) {
  const isAuto = l[key] === "auto";
  const c = h("input", { type: "color", value: isAuto ? "#111111" : (l[key] || "#000000"), oninput: () => { l[key] = c.value; requestDraw(); if (a) a.checked = false; }, onchange: () => commit() });
  const a = allowAuto ? h("input", { type: "checkbox", checked: isAuto, onchange: e => { l[key] = e.target.checked ? "auto" : c.value; commit(); requestDraw(); } }) : null;
  return rowOf(label, c, allowAuto ? h("label", { style: "display:flex;gap:4px;align-items:center;color:var(--muted)" }, a, "auto") : null);
}
function select(label, opts, get, set) {
  const s = h("select", { onchange: () => { set(s.value); commit(); requestDraw(); } }, ...opts.map(([v, t]) => h("option", { value: v, selected: String(get()) === String(v) }, t)));
  return rowOf(label, s);
}
function textBlock(l) {
  const ta = h("textarea", { class: "big", value: l.text || "", placeholder: "Dialogue… (double-click the bubble to type on the page)",
    oninput: () => { l.text = ta.value; requestDraw(); }, onchange: () => commit("Text edited") });
  return ta;
}
function fontRows(l) {
  return [
    select("Font", FONTS, () => l.font || "MMComic", v => l.font = v),
    h("div", { class: "row" }, h("label", {}, "Size"),
      h("input", { type: "number", min: 0, value: l.fontSize || 0, style: "width:64px", onchange: e => { l.fontSize = +e.target.value; commit(); requestDraw(); } }),
      h("span", { class: "hint" }, "0 = fit"), check("Bold", () => l.bold, v => l.bold = v), check("Italic", () => l.italic, v => l.italic = v)),
  ];
}
function refreshProps(valuesOnly) {
  const l = selL();
  if (valuesOnly && l) { // keep focus: only update geometry fields
    $$("#props input[data-k]").forEach(i => { if (document.activeElement !== i) i.value = Math.round((l[i.dataset.k] ?? 0) * 100) / 100; });
    return;
  }
  const P = $("#props"); P.innerHTML = "";
  $("#propstitle").textContent = l ? ({ panel: "Panel", bubble: "Speech bubble", caption: "Caption", text: l.sfx ? "Sound effect" : "Text", image: "Image", vbubble: "Drawn bubble", tone: "Screentone", speed: l.mode === "focus" ? "Focus lines" : "Speed lines" })[l.type] : `Page ${S.page + 1}`;
  if (!l) return pageProps(P);
  P.append(h("div", { class: "grid4" }, num("X", l, "x"), num("Y", l, "y"), num("W", l, "w"), num("H", l, "h")));
  if (l.type !== "panel") P.append(h("div", { class: "row" }, h("label", {}, "Rotate"), h("input", { type: "number", value: l.rotate || 0, step: 1, "data-k": "rotate",
    onchange: e => { l.rotate = +e.target.value; commit(); requestDraw(); } }), h("span", { class: "hint" }, "°  Shift snaps 15°")));
  if (l.type === "panel") panelProps(P, l);
  if (l.type === "bubble") {
    const m = bubbleMeta(l.bubble);
    P.append(textBlock(l),
      rowOf("Template", h("img", { src: thumb(m.ref, 120), style: "height:44px;background:#e9e9ec;border-radius:4px;padding:2px" }),
        h("button", { onclick: () => { S.libTab = "bubbles"; renderLibrary(); } }, `#${m.key} · change…`)),
      ...fontRows(l), colorRow("Text color", l, "color", true),
      h("div", { class: "btnrow" }, check("Flip tail", () => l.flip, v => l.flip = v), check("Vertical text", () => l.vertical, v => l.vertical = v)));
  }
  if (l.type === "caption") {
    P.append(textBlock(l), ...fontRows(l), colorRow("Text color", l, "color", true), colorRow("Fill", l, "fill"),
      h("div", { class: "row" }, h("label", {}, "Border"), h("input", { type: "number", min: 0, value: l.borderW, onchange: e => { l.borderW = +e.target.value; commit(); requestDraw(); } })));
  }
  if (l.type === "text") {
    P.append(textBlock(l), ...fontRows(l), colorRow("Color", l, "color"), colorRow("Outline", l, "stroke"),
      slider("Outline w", () => l.strokeWidth || 0, v => l.strokeWidth = v, 0, 40, 1),
      select("Align", [["center", "Center"], ["left", "Left"], ["right", "Right"]], () => l.align || "center", v => l.align = v),
      h("div", { class: "btnrow" }, check("Vertical (tategaki)", () => l.vertical, v => l.vertical = v)));
  }
  if (l.type === "image") P.append(h("div", { class: "btnrow" }, check("Flip", () => l.flip, v => l.flip = v)));
  const clipRow = () => select("Clip to", [["", "— none —"], ...panelOrder(layers()).map((q, i) => [q.id, `Panel ${i + 1}${q.shot ? " · " + q.shot : ""}`])],
    () => l.clip || "", v => l.clip = v || null);
  const reseed = () => h("button", { onclick: () => { l.seed = Math.floor(Math.random() * 1e6); commit("Reshuffled"); requestDraw(); } }, "Reshuffle");
  if (l.type === "vbubble") {
    P.append(textBlock(l), select("Shape", VSHAPES, () => l.shape, v => l.shape = v), ...fontRows(l), colorRow("Text color", l, "color", true),
      h("div", { class: "row" }, h("label", {}, "Fill / line"),
        h("input", { type: "color", value: l.fill, oninput: e => { l.fill = e.target.value; requestDraw(); }, onchange: () => commit() }),
        h("input", { type: "color", value: l.stroke, oninput: e => { l.stroke = e.target.value; requestDraw(); }, onchange: () => commit() }),
        h("input", { type: "number", min: 0, value: l.strokeW, style: "width:56px", title: "line width", onchange: e => { l.strokeW = +e.target.value; commit(); requestDraw(); } })),
      slider("Tail width", () => l.tailW, v => l.tailW = v, 0.05, 0.6, 0.01, v => v.toFixed(2)),
      ["burst", "flash"].includes(l.shape) ? slider("Spikes", () => l.spikes, v => l.spikes = v, 6, 48, 1) : null,
      h("div", { class: "btnrow" },
        h("button", { onclick: () => { l.tail = l.tail ? null : { x: -l.w * 0.18, y: l.h * 0.85 }; commit(); requestDraw(); refreshProps(); } }, l.tail ? "Remove tail" : "Add tail"),
        ["cloud", "burst", "flash"].includes(l.shape) ? reseed() : null, check("Vertical text", () => l.vertical, v => l.vertical = v)),
      h("p", { class: "hint" }, "Drag the pink dot to aim the tail."));
  }
  if (l.type === "tone") {
    P.append(select("Preset", [["", "— apply a preset —"], ...TONE_PRESETS.map(([t], i) => [i, t])], () => "", v => { if (v !== "") Object.assign(l, TONE_PRESETS[+v][1]); refreshProps(); }),
      select("Pattern", [["dots", "Dots (amitone)"], ["lines", "Lines"], ["cross", "Crosshatch"], ["noise", "Sand / noise"], ["solid", "Flat"]], () => l.pattern, v => l.pattern = v),
      slider("Cell size", () => l.size, v => l.size = v, 3, 40, 1, v => v + "px"),
      slider("Density", () => l.density, v => l.density = v, 0.02, 1, 0.01, v => Math.round(v * 100) + "%"),
      slider("Angle", () => l.angle, v => l.angle = v, 0, 180, 1, v => v + "°"),
      select("Gradient", [["none", "None"], ["down", "Fade downward"], ["up", "Fade upward"], ["right", "Fade to the right"], ["left", "Fade to the left"],
        ["edges", "Dark edges (vignette)"], ["center", "Dark centre"]], () => l.fade, v => l.fade = v),
      colorRow("Color", l, "color"), clipRow(), l.pattern === "noise" ? h("div", { class: "btnrow" }, reseed()) : null);
  }
  if (l.type === "speed") {
    P.append(select("Kind", [["focus", "Focus lines (集中線)"], ["parallel", "Speed lines (流線)"]], () => l.mode, v => l.mode = v),
      slider("Lines", () => l.count, v => l.count = v, 10, 600, 1),
      slider("Thickness", () => l.thick, v => l.thick = v, 1, 60, 0.5),
      slider(l.mode === "focus" ? "Empty centre" : "Gap", () => l.inner, v => l.inner = v, 0, 0.95, 0.01, v => Math.round(v * 100) + "%"),
      slider("Jitter", () => l.jitter, v => l.jitter = v, 0, 1, 0.01, v => Math.round(v * 100) + "%"),
      l.mode === "parallel" ? slider("Direction", () => l.angle, v => l.angle = v, -90, 90, 1, v => v + "°") : null,
      colorRow("Color", l, "color"), clipRow(), h("div", { class: "btnrow" }, reseed()));
  }
  P.append(h("div", { class: "section" }, "Layer"),
    slider("Opacity", () => l.opacity ?? 1, v => l.opacity = v, 0, 1, 0.01, v => Math.round(v * 100) + "%"),
    select("Blend", [["source-over", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"], ["difference", "Difference"]],
      () => l.blend, v => l.blend = v),
    h("div", { class: "btnrow" }, h("button", { onclick: act.toFront }, "To front"), h("button", { onclick: act.toBack }, "To back"),
      h("button", { onclick: act.duplicate }, "Duplicate"), h("button", { class: "danger", onclick: act.remove }, "Delete")));
}
function panelProps(P, l) {
  const shot = S.shots.find(s => s.name === l.shot);
  P.append(h("div", { class: "section" }, "Shot"),
    select("Shot", [["", "— none —"], ...S.shots.map(s => [s.name, s.name + (s.renders.length ? "" : " (no render)")])], () => l.shot || "", v => {
      l.shot = v; const s = S.shots.find(q => q.name === v);
      if (s?.renders[0]) setPanelImage(l, s.renders[0], v); else { l.image = null; }
    }));
  if (shot && (shot.renders.length || shot.finals.length)) {
    P.append(h("div", { class: "renders" }, ...[...shot.renders, ...shot.finals].map(ref =>
      h("img", { src: thumb(ref, 160), class: l.image?.ref === ref ? "on" : "", title: ref.split("/").pop(), onclick: () => setPanelImage(l, ref, shot.name) }))));
  }
  P.append(h("div", { class: "btnrow" },
    h("button", { onclick: () => shotDialog(l.shot || null) }, "Edit shot…"),
    h("button", { onclick: () => poseForPanel(l), title: "Pose the characters for this panel (no game needed)" }, "Pose…"),
    l.shot ? h("button", { class: "primary", onclick: () => renderShot(l.shot) }, "Render on pod") : null));
  if (l.image) {
    const I = l.image;
    P.append(h("div", { class: "section" }, "Render in panel"),
      select("Fit", [["cover", "Cover (crop)"], ["contain", "Contain"]], () => I.fit, v => { I.fit = v; I.zoom = 1; }),
      slider("Zoom", () => I.zoom || 1, v => I.zoom = v, I.fit === "contain" ? 0.2 : 1, 5, 0.01, v => v.toFixed(2) + "×"),
      h("div", { class: "btnrow" }, check("Flip", () => I.flip, v => I.flip = v),
        h("button", { onclick: () => enterAdjust(l) }, "Reposition (Enter)"),
        h("button", { onclick: () => { l.image = null; commit("Image removed"); requestDraw(); refreshPanels(); } }, "Remove image")));
  }
  P.append(h("div", { class: "section" }, "Frame"),
    h("div", { class: "row" }, h("label", {}, "Border"), h("input", { type: "number", min: 0, value: l.border, style: "width:64px", onchange: e => { l.border = +e.target.value; commit(); requestDraw(); } }),
      h("input", { type: "color", value: l.borderColor, oninput: e => { l.borderColor = e.target.value; requestDraw(); }, onchange: () => commit() }),
      h("span", { class: "hint" }, "fill"), h("input", { type: "color", value: l.fill, oninput: e => { l.fill = e.target.value; requestDraw(); }, onchange: () => commit() })),
    h("div", { class: "btnrow" }, h("button", { onclick: () => act.split("v") }, "Split ⇆"), h("button", { onclick: () => act.split("h") }, "Split ⇅")));
}
function pageProps(P) {
  const pg = page();
  P.append(
    rowOf("Title", h("input", { value: S.doc.title, style: "flex:1", onchange: e => { S.doc.title = e.target.value; commit(); } })),
    select("Reading", [["rtl", "Right to left (manga)"], ["ltr", "Left to right"]], () => S.doc.reading, v => S.doc.reading = v),
    colorRow("Paper", pg, "bg"),
    h("div", { class: "row" }, h("label", {}, "Max text"), h("input", { type: "number", value: S.doc.maxFont, onchange: e => { S.doc.maxFont = +e.target.value; commit(); requestDraw(); } }),
      h("span", { class: "hint" }, "px, keeps fitted text even")),
    h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: layoutDialog }, "Choose layout…"),
      h("button", { onclick: () => { S.showOrder = !S.showOrder; requestDraw(); } }, "Toggle panel order")),
    h("p", { class: "hint" }, "Pick a layout, drag renders from Shots onto panels, then letter with B (bubble), T (text), S (SFX), C (caption). " +
      "Double-click a panel to reposition its render, double-click a bubble to type. Space-drag pans, Ctrl/⌘+scroll zooms."));
}

/* ================================================================ layers list */
const TYPE_IC = { panel: "▭", bubble: "💬", vbubble: "🗨", caption: "▤", text: "T", image: "🖼", tone: "▦", speed: "✺" };
function layerName(l) {
  if (l.name) return l.name;
  if (l.type === "panel") return "Panel" + (l.shot ? ` · ${l.shot}` : "");
  if (l.type === "image") return l.ref.split("/").pop();
  if (l.type === "tone") return `Screentone · ${l.pattern}${l.fade !== "none" ? " " + l.fade : ""}`;
  if (l.type === "speed") return l.mode === "focus" ? "Focus lines" : "Speed lines";
  const t = (l.text || "").replace(/\s+/g, " ").trim();
  return (l.sfx ? "SFX" : l.type === "bubble" || l.type === "vbubble" ? "Bubble" : l.type === "caption" ? "Caption" : "Text") + (t ? ` · ${t}` : "");
}
function renderLayers() {
  const box = $("#layers"); box.innerHTML = "";
  const ls = layers();
  [...ls].reverse().forEach(l => {
    const row = h("div", { class: "layer" + (l.id === S.sel ? " on" : ""), draggable: true,
      onclick: () => { S.sel = l.id; refreshPanels(); requestDraw(); },
      ondblclick: () => { const n = prompt("Layer name", layerName(l)); if (n != null) { l.name = n; commit(); } },
      ondragstart: e => e.dataTransfer.setData("text/layer", l.id),
      ondragover: e => { e.preventDefault(); row.classList.add("dragover"); },
      ondragleave: () => row.classList.remove("dragover"),
      ondrop: e => {
        e.preventDefault(); row.classList.remove("dragover");
        const id = e.dataTransfer.getData("text/layer"), src = ls.find(q => q.id === id); if (!src || src === l) return;
        ls.splice(ls.indexOf(src), 1); ls.splice(ls.indexOf(l) + 1, 0, src); commit("Reordered"); requestDraw();
      } },
      h("button", { class: l.visible ? "" : "offv", title: "Show/hide", onclick: e => { e.stopPropagation(); l.visible = !l.visible; commit(); requestDraw(); } }, "👁"),
      h("span", { class: "ic" }, TYPE_IC[l.type]),
      h("span", { class: "nm" }, layerName(l)),
      h("button", { class: l.locked ? "" : "offv", title: "Lock", onclick: e => { e.stopPropagation(); l.locked = !l.locked; commit(); requestDraw(); } }, "🔒"));
    box.append(row);
  });
  if (!ls.length) box.append(h("div", { class: "hint" }, "Empty page. Choose a layout or draw panels with P."));
}

/* ================================================================ library */
const LIBTABS = [["shots", "Shots"], ["bubbles", "Bubbles"], ["layouts", "Layouts"], ["decor", "Decor"], ["speedlines", "Speed lines"], ["particles", "Particles"], ["uploads", "Uploads"]];
function renderLibrary() {
  const tabs = $("#libtabs"); tabs.innerHTML = "";
  for (const [k, t] of LIBTABS) tabs.append(h("button", { class: S.libTab === k ? "on" : "", onclick: () => { S.libTab = k; renderLibrary(); } }, t));
  const tools = $("#libtools"); tools.innerHTML = "";
  const lib = $("#library"); lib.innerHTML = "";
  const drag = (el, data) => { el.draggable = true; el.addEventListener("dragstart", e => e.dataTransfer.setData("application/x-manga", JSON.stringify(data))); };
  if (S.libTab === "shots") {
    tools.append(h("button", { onclick: () => shotDialog(null, true) }, "＋ New shot"), h("button", { onclick: () => shotDialog(null) }, "Edit shots…"),
      h("button", { onclick: loadShots, title: "Rescan shots/" }, "⟳"));
    if (!S.shots.length) lib.append(h("div", { class: "hint" }, "No shots yet. Create one, pose it in CharaStudio, then Grab and Render."));
    for (const s of S.shots) {
      const imgs = h("div", { class: "imgs" });
      const all = [...s.renders.map(r => [r, "render"]), ...s.finals.map(r => [r, "final"])];
      for (const [ref, kind] of all) {
        const im = h("img", { src: thumb(ref, 200), title: `${kind}: ${ref.split("/").pop()} — drag onto a panel`, loading: "lazy",
          onclick: () => { const l = selL(); if (l?.type === "panel") setPanelImage(l, ref, s.name); else status("Select a panel, or drag the render onto one"); } });
        drag(im, { kind: "render", ref, shot: s.name }); imgs.append(im);
      }
      if (!all.length) imgs.append(...[s.pose && h("img", { src: thumb(s.pose, 200), title: "pose (not rendered yet)", style: "opacity:.7" }),
        h("div", { class: "none" }, s.pose ? "Not rendered yet." : "No pose yet: Grab from Studio.")].filter(Boolean));
      lib.append(h("div", { class: "shotcard" },
        h("div", { class: "top" }, h("b", { title: s.name }, s.name), h("span", {},
          h("span", { class: "badge" }, `${s.renders.length} render${s.renders.length === 1 ? "" : "s"}`), " ",
          h("button", { onclick: () => shotDialog(s.name) }, "Edit"), " ",
          h("button", { class: "primary", onclick: () => renderShot(s.name), disabled: !s.pose, title: "Render on the RunPod pod" }, "Render"))),
        imgs));
    }
    return;
  }
  if (S.libTab === "bubbles") {
    if (!S.cat.bubbles.length) { lib.append(h("div", { class: "hint" }, "No bubble templates installed (templates_dir in config). The drawn bubble tool (O) needs none.")); return; }
    lib.append(h("div", { class: "hint" }, "Click to pick for the bubble tool (or to swap the selected bubble). Drag onto the page to place."));
    const t = h("div", { class: "tiles" });
    for (const b of S.cat.bubbles) {
      const el = h("div", { class: "tile light" + (b.key === S.bubble ? " on" : ""), title: "#" + b.key, onclick: () => {
        S.bubble = b.key; const l = selL();
        if (l?.type === "bubble") { const k = l.w; l.bubble = b.key; l.h = k * b.h / b.w; commit("Bubble changed"); requestDraw(); }
        else setTool("bubble");
        renderLibrary(); renderOptions();
      } }, h("img", { src: thumb(b.ref, 160), loading: "lazy" }), h("div", { class: "cap" }, "#" + b.key));
      drag(el, { kind: "bubble", key: b.key }); t.append(el);
    }
    lib.append(t); return;
  }
  if (S.libTab === "layouts") {
    lib.append(h("div", { class: "hint" }, "Click to apply to this page (renders already placed carry over in reading order)."),
      h("div", { class: "section" }, "Built-in"), presetTiles((r, n) => applyLayout(r, n)));
    if (!S.cat.layouts.length) return;
    lib.append(h("div", { class: "section" }, "Template pack"));
    const t = h("div", { class: "tiles" });
    for (const L of S.cat.layouts) t.append(h("div", { class: "tile page", title: `Template ${L.n}: ${L.rects.length} panels`,
      onclick: () => applyLayout(L.rects, "#" + L.n) }, h("img", { src: thumb(L.ref, 160), loading: "lazy" }), h("div", { class: "cap" }, `#${L.n} · ${L.rects.length}`)));
    lib.append(t); return;
  }
  const list = S.cat.assets[S.libTab] || [];
  if (S.libTab === "uploads") {
    const fi = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true, onchange: async () => { for (const f of fi.files) await uploadFile(f); } });
    tools.append(fi, h("button", { onclick: () => fi.click() }, "Upload images…"));
    if (!list.length) lib.append(h("div", { class: "hint" }, "Upload screentones, backgrounds or logos, or drop image files straight onto the page."));
  }
  const t = h("div", { class: "tiles wide" });
  for (const a of list) {
    const el = h("div", { class: "tile light", title: a.name + " — click to add, or drag", onclick: async () => {
      const dim = await imgSize(a.ref); addImageLayer(a.ref, dim.w, dim.h, null, a.multiply);
    } }, h("img", { src: thumb(a.ref, 260), loading: "lazy" }), h("div", { class: "cap" }, a.name));
    drag(el, { kind: "asset", ref: a.ref, multiply: a.multiply }); t.append(el);
  }
  lib.append(t);
}
function imgSize(ref) {
  return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = `/img?ref=${encodeURIComponent(ref)}&w=${imgW(ref)}`; });
}
async function uploadFile(f, at) {
  try {
    const r = await post(`/api/upload?name=${encodeURIComponent(f.name)}`, f, true);
    S.cat.assets.uploads.push({ ref: r.ref, name: r.name, multiply: false });
    if (S.libTab === "uploads") renderLibrary();
    return r;
  } catch (e) { toast(e.message, "err"); }
}

/* drag & drop onto the canvas */
const mark = $("#dropmark");
stage.addEventListener("dragover", e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
  const pl = hitLayer(p, l => l.type === "panel");
  const isRender = e.dataTransfer.types.includes("application/x-manga") || e.dataTransfer.types.includes("Files");
  if (pl && isRender) {
    const a = toScreen(pl.x, pl.y);
    Object.assign(mark.style, { display: "block", left: a.x + "px", top: a.y + "px", width: pl.w * S.view.s + "px", height: pl.h * S.view.s + "px" });
  } else mark.style.display = "none";
});
stage.addEventListener("dragleave", () => mark.style.display = "none");
stage.addEventListener("drop", async e => {
  e.preventDefault(); mark.style.display = "none";
  const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
  const pl = hitLayer(p, l => l.type === "panel");
  if (e.dataTransfer.files.length) {
    for (const f of e.dataTransfer.files) {
      const u = await uploadFile(f); if (!u) continue;
      if (pl && !pl.image) setPanelImage(pl, u.ref, ""); else addImageLayer(u.ref, u.w, u.h, p, false);
    }
    return;
  }
  const raw = e.dataTransfer.getData("application/x-manga"); if (!raw) return;
  const d = JSON.parse(raw);
  if (d.kind === "render") {
    if (pl) { S.sel = pl.id; setPanelImage(pl, d.ref, d.shot); }
    else { const dim = await imgSize(d.ref); addImageLayer(d.ref, dim.w, dim.h, p, false); }
  } else if (d.kind === "bubble") { S.bubble = d.key; createAt("bubble", { x: p.x, y: p.y, w: 0, h: 0 }, true); }
  else if (d.kind === "asset") { const dim = await imgSize(d.ref); addImageLayer(d.ref, dim.w, dim.h, p, d.multiply); }
  refreshPanels();
});

/* ================================================================ options bar */
function renderOptions() {
  const o = $("#optionsbar"); o.innerHTML = "";
  const name = { move: "Move", hand: "Hand", panel: "Panel", bubble: "Bubble", vbubble: "Drawn bubble", text: "Text", sfx: "Sound effect", caption: "Caption",
    tone: "Screentone", speed: "Speed lines" }[S.tool];
  o.append(h("span", { class: "tname" }, name));
  const sep = () => h("span", { class: "sep" });
  if (S.tool === "move") o.append(h("span", { class: "hint" }, "Drag to move · Alt-drag duplicates · ⌘-click picks the panel under a bubble · Shift locks axis · Ctrl disables snapping"));
  if (S.tool === "panel") o.append(h("span", { class: "hint" }, "Drag a frame on the page. Snaps to page edges and 30 px gutters."), sep(),
    h("button", { onclick: layoutDialog }, "Layouts…"));
  if (S.tool === "bubble") {
    const m = bubbleMeta(S.bubble);
    o.append(h("img", { src: thumb(m.ref, 80) }), h("span", {}, "#" + m.key), h("button", { onclick: () => { S.libTab = "bubbles"; renderLibrary(); } }, "Pick bubble…"), sep(),
      h("span", { class: "hint" }, "Click to place, or drag to size it"));
  }
  if (S.tool === "text" || S.tool === "sfx" || S.tool === "caption") o.append(h("span", { class: "hint" }, "Click to place, or drag a box. Type straight away; Esc when done."));
  if (S.tool === "hand") o.append(h("span", { class: "hint" }, "Drag to pan. Ctrl/⌘ + scroll zooms."));
  if (S.tool === "vbubble") o.append(...VSHAPES.map(([k, t]) => h("button", { class: S.vshape === k ? "primary" : "", onclick: () => { S.vshape = k; renderOptions(); } }, t)), sep(),
    h("span", { class: "hint" }, "Click or drag to place; drag the pink dot to aim the tail"));
  if (S.tool === "tone") o.append(h("select", { onchange: e => { S.tonePreset = +e.target.value; } },
    ...TONE_PRESETS.map(([t], i) => h("option", { value: i, selected: i === S.tonePreset }, t))), sep(),
    h("span", { class: "hint" }, "Click a panel to fill it (clipped to the panel), or drag an area. Use Multiply blend over renders."));
  if (S.tool === "speed") o.append(...[["focus", "Focus lines 集中線"], ["parallel", "Speed lines 流線"]].map(([k, t]) =>
    h("button", { class: S.speedMode === k ? "primary" : "", onclick: () => { S.speedMode = k; renderOptions(); } }, t)), sep(),
    h("span", { class: "hint" }, "Click a panel to fill it, or drag an area. Tweak count, thickness and the empty centre in Properties."));
  o.append(h("div", { class: "spacer" }),
    h("button", { class: "ghost", title: "Snapping guides", onclick: () => { S.showGuides = !S.showGuides; renderOptions(); } }, S.showGuides ? "Snap: on" : "Snap: off"),
    h("button", { class: "ghost", onclick: fitView, title: "⌘0" }, "Fit"),
    h("button", { class: "ghost", onclick: () => { const r = stage.getBoundingClientRect(); zoomAt(1 / S.view.s, r.width / 2, r.height / 2); } }, "100%"));
}

/* ================================================================ pages strip */
let thumbT = null;
function schedThumbs(all) { S.thumbAll ||= !!all; clearTimeout(thumbT); thumbT = setTimeout(() => { renderPageThumbs(!S.thumbAll); S.thumbAll = false; }, 250); }
function pageThumb(i, cls = "", w = 192) {
  const c = h("canvas", { width: w, height: w * 1.5, "data-page": i });
  const vertical = !cls.includes("ov");
  const el = h("div", { class: "pthumb " + cls + (i === S.page ? " on" : ""), title: `Page ${i + 1}`, draggable: true,
    onclick: () => { gotoPage(i); if (!$("#overview").hidden) toggleOverview(false); },
    oncontextmenu: e => { e.preventDefault(); gotoPage(i); popMenu(e.clientX, e.clientY, pageMenu()); },
    ondragstart: e => { e.dataTransfer.setData("text/page", String(i)); e.dataTransfer.effectAllowed = "move"; },
    ondragover: e => {
      if (!e.dataTransfer.types.includes("text/page")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), after = vertical ? e.clientY > r.top + r.height / 2 : (e.clientX > r.left + r.width / 2) !== (S.doc.reading !== "ltr");
      el.classList.remove("dropbefore", "dropafter", "dropleft", "dropright");
      el.classList.add(vertical ? (after ? "dropafter" : "dropbefore") : ((e.clientX > r.left + r.width / 2) ? "dropright" : "dropleft"));
      el.dataset.after = after ? "1" : "";
    },
    ondragleave: () => el.classList.remove("dropbefore", "dropafter", "dropleft", "dropright"),
    ondrop: e => {
      e.preventDefault(); el.classList.remove("dropbefore", "dropafter", "dropleft", "dropright");
      const from = +e.dataTransfer.getData("text/page");
      movePage(from, i + (el.dataset.after ? 1 : 0));
    } }, c, h("div", {}, i + 1));
  return el;
}
function movePage(from, to) {
  if (from === to || from + 1 === to) return;
  const cur = S.doc.pages[S.page], pg = S.doc.pages.splice(from, 1)[0];
  S.doc.pages.splice(to > from ? to - 1 : to, 0, pg);
  S.page = S.doc.pages.indexOf(cur);
  commit("Page moved"); renderPages();
}
function renderPages() {
  const box = $("#pages"); box.innerHTML = "";
  S.doc.pages.forEach((_, i) => box.append(pageThumb(i)));
  $("#pagecount").textContent = `Pages ${S.doc.pages.length}`;
  if (!$("#overview").hidden) renderOverview();
  renderPageThumbs();
  box.querySelector(".pthumb.on")?.scrollIntoView({ block: "nearest" });
}
function renderPageThumbs(onlyCurrent) {
  $$("canvas[data-page]").forEach(c => {
    const i = +c.dataset.page, pg = S.doc.pages[i];
    if (!pg || (onlyCurrent && i !== S.page)) return;
    const g = c.getContext("2d");
    if (i === S.page && !PC.dirty && PC.key.startsWith(pg.id + "|")) { g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(PC.c, 0, 0, c.width, c.height); return; }
    g.setTransform(c.width / W(), 0, 0, c.height / H(), 0, 0); drawPage(g, pg, { export: false, rs: c.width / W() });
  });
}
/* whole book: spreads in reading order (page 1 opens on its own, like a printed volume) */
function renderOverview() {
  const grid = $("#ovgrid"); grid.innerHTML = "";
  const n = S.doc.pages.length, rtl = S.doc.reading !== "ltr", spreads = $("#ovspreads").checked;
  $("#ovtitle").textContent = `${S.doc.title} · ${n} page${n > 1 ? "s" : ""}`;
  if (!spreads) { S.doc.pages.forEach((_, i) => grid.append(pageThumb(i, "ov", 300))); renderPageThumbs(); return; }
  const groups = [[0]];
  for (let i = 1; i < n; i += 2) groups.push(i + 1 < n ? [i, i + 1] : [i]);
  for (const g of groups) {
    let cells = g.map(i => pageThumb(i, "ov", 300));
    if (g[0] === 0) cells = [h("div", { class: "ghostpage" }), ...cells];          // page 1 sits on the right
    else if (cells.length === 1) cells.push(h("div", { class: "ghostpage" }));
    if (rtl && g[0] !== 0) cells.reverse();                                          // manga: the later page is on the left
    grid.append(h("div", { class: "spread" }, ...cells));
  }
  renderPageThumbs();
}
function toggleOverview(show) {
  const ov = $("#overview"); ov.hidden = !(show ?? ov.hidden);
  if (!ov.hidden) renderOverview();
}
$("#ovbtn").onclick = () => toggleOverview();
$("#ovclose").onclick = () => toggleOverview(false);
$("#ovspreads").onchange = renderOverview;
$("#ovadd").onclick = () => { S.page = S.doc.pages.length - 1; pageOps.add(); };
function gotoPage(i) { if (S.adjust) exitAdjust(); S.page = clamp(i, 0, S.doc.pages.length - 1); S.sel = null; snapshot(); refreshPanels(); renderPages(); requestDraw(); }
const pageOps = {
  add() { S.doc.pages.splice(S.page + 1, 0, { id: uid(), bg: "#ffffff", layers: [] }); S.page++; commit("Page added"); renderPages(); requestDraw(); if ($("#overview").hidden) layoutDialog(); },
  dup() { const c = deep(page()); c.id = uid(); c.layers.forEach(l => l.id = uid()); S.doc.pages.splice(S.page + 1, 0, c); S.page++; commit("Page duplicated"); renderPages(); requestDraw(); },
  del() { if (S.doc.pages.length < 2) return toast("A project needs one page"); if (!confirm(`Delete page ${S.page + 1}?`)) return;
    S.doc.pages.splice(S.page, 1); S.page = Math.max(0, S.page - 1); commit("Page deleted"); renderPages(); requestDraw(); },
  left() { if (S.page < 1) return; const p = S.doc.pages.splice(S.page, 1)[0]; S.doc.pages.splice(--S.page, 0, p); commit(); renderPages(); },
  right() { if (S.page >= S.doc.pages.length - 1) return; const p = S.doc.pages.splice(S.page, 1)[0]; S.doc.pages.splice(++S.page, 0, p); commit(); renderPages(); },
};
const pageMenu = () => [["Add page after", pageOps.add, sc("New page")], ["Duplicate page", pageOps.dup, sc("Duplicate page")], ["Move page earlier", pageOps.left, sc("Move page earlier")],
  ["Move page later", pageOps.right, sc("Move page later")], null, ["Delete page", pageOps.del, sc("Delete page")]];
$("#addpage").onclick = () => pageOps.add();

/* ================================================================ menus */
const MENUS = {
  File: () => [["New project", newProject, sc("New project")], ["Open…", openDialog, sc("Open project")], ["Save", () => save(), sc("Save")], ["Save as…", () => save(true), sc("Save as")], null,
    ["Import page script…", importDialog, sc("Import page script")], null, ["Export this page (PNG)", () => exportPages("one"), sc("Export this page")],
    ["Export all pages + PDF", () => exportPages("all"), sc("Export all pages + PDF")], ["Download this page", downloadPage]],
  Edit: () => [["Undo", undo, sc("Undo"), !S.undo.length], ["Redo", redo, sc("Redo"), !S.redo.length], null,
    ["Cut", act.cut, sc("Cut layer"), !selL()], ["Copy", act.copy, sc("Copy layer"), !selL()], ["Paste", act.paste, sc("Paste layer (works across pages)"), !S.clip],
    ["Duplicate", act.duplicate, sc("Duplicate layer"), !selL()], ["Delete", act.remove, "Del", !selL()], null,
    ["Deselect", act.escape, "Esc"], ["Keyboard shortcuts", shortcutSheet, "?"]],
  Layer: () => [["Bring forward", act.layerUp, sc("Bring forward")], ["Send backward", act.layerDown, sc("Send backward")],
    ["Bring to front", act.toFront, sc("Bring to front")], ["Send to back", act.toBack, sc("Send to back")], null,
    ["Select layer above", () => act.selectStep(1), sc("Select layer above")], ["Select layer below", () => act.selectStep(-1), sc("Select layer below")], null,
    ["Flip", act.flip, sc("Flip (bubble tail, image, panel render)"), !selL()], ["Reset rotation", act.resetRotation, sc("Reset rotation"), !selL()?.rotate],
    ["Lock / unlock", act.toggleLock, sc("Lock / unlock"), !selL()], ["Hide / show", act.toggleHide, sc("Hide / show"), !selL()], null,
    ["Split panel ⇆", () => act.split("v"), sc("Split panel side by side"), selL()?.type !== "panel"], ["Split panel ⇅", () => act.split("h"), sc("Split panel top / bottom"), selL()?.type !== "panel"],
    ["Reposition render", act.enter, "↵", !(selL()?.image)], ["Render shot on pod", act.renderSel, sc("Render the panel's shot on the pod"), !selL()?.shot]],
  Page: () => [["Whole-book overview", () => toggleOverview(true), sc("Whole-book overview")], ["Next page", () => gotoPage(S.page + 1), sc("Next page")],
    ["Previous page", () => gotoPage(S.page - 1), sc("Previous page")], ["First page", () => gotoPage(0), "Home"], ["Last page", () => gotoPage(S.doc.pages.length - 1), "End"], null,
    ["Choose layout…", layoutDialog, sc("Choose layout")], null, ...pageMenu()],
  View: () => [["Fit page", fitView, sc("Fit page")], ["Actual pixels", () => zoomAt(1 / S.view.s, ...center()), sc("Actual pixels")],
    ["Zoom in", () => zoomAt(1.25, ...center()), sc("Zoom in")], ["Zoom out", () => zoomAt(0.8, ...center()), sc("Zoom out")], null,
    [(S.showOrder ? "Hide" : "Show") + " panel order", () => { S.showOrder = !S.showOrder; requestView(); }, sc("Show / hide panel order")],
    [(S.showGuides ? "Disable" : "Enable") + " snapping", () => { S.showGuides = !S.showGuides; renderOptions(); }, sc("Snapping on / off")],
    [(S.showPrint ? "Hide" : "Show") + " print guides (trim / safe area)", () => { S.showPrint = !S.showPrint; requestView(); }, sc("Print guides on / off")]],
  Pipeline: () => [["Pose studio", () => setMode("pose"), sc("Pose studio")], ["Pose the selected panel…", () => poseForPanel(selL()), "", selL()?.type !== "panel"], null, ["Shots…", () => shotDialog(selL()?.shot || null), sc("Shots (edit, grab, render)")], ["New shot…", () => shotDialog(null, true)], null,
    ["Pod status", () => refreshPod(true)], ["Open ComfyUI on the pod", () => S.pod?.url ? window.open(S.pod.url, "_blank") : toast("Pod URL unknown"), "", !S.pod?.url],
    ["Start pod", () => podAction("start")], ["Stop pod (ends GPU billing)", () => podAction("stop")], null, ["Jobs", () => toggleJobs(true), sc("Jobs log")]],
  Help: () => [["Keyboard shortcuts", shortcutSheet, "?"]],
};
function buildMenus() {
  const m = $("#menus"); m.innerHTML = "";
  for (const k of Object.keys(MENUS)) m.append(h("button", { onclick: e => { const r = e.target.getBoundingClientRect(); popMenu(r.left, r.bottom + 2, MENUS[k]()); } }, k));
}
function popMenu(x, y, items) {
  const pop = $("#menu-pop"); pop.innerHTML = "";
  for (const it of items) {
    if (!it) { pop.append(h("hr")); continue; }
    const [t, fn, key, dis] = it;
    pop.append(h("div", { class: "mi" + (dis ? " dis" : ""), onclick: () => { closeMenu(); fn(); } }, h("span", {}, t), h("span", { class: "k" }, key || "")));
  }
  pop.hidden = false; pop.style.left = x + "px"; pop.style.top = y + "px";
  const r = pop.getBoundingClientRect(); if (r.right > innerWidth) pop.style.left = innerWidth - r.width - 8 + "px"; if (r.bottom > innerHeight) pop.style.top = innerHeight - r.height - 8 + "px";
  setTimeout(() => document.addEventListener("pointerdown", outside), 0);
}
function outside(e) { if (!e.target.closest("#menu-pop")) closeMenu(); }
function closeMenu() { $("#menu-pop").hidden = true; document.removeEventListener("pointerdown", outside); }

/* ================================================================ modal */
function modal(title, cls) {
  const box = $("#modalbox"); box.className = cls || ""; box.innerHTML = "";
  box.append(h("div", { class: "mhead" }, title, h("button", { class: "ghost", onclick: closeModal }, "✕")), h("div", { class: "mbody" }));
  $("#modal").hidden = false;
  return box;
}
function closeModal() { $("#modal").hidden = true; }
$("#modal").addEventListener("pointerdown", e => { if (e.target.id === "modal") closeModal(); });

/* ================================================================ shots */
async function loadShots() {
  try { S.shots = await api("/api/shots"); } catch (e) { toast(e.message, "err"); }
  if (S.libTab === "shots") renderLibrary();
  if (selL()?.type === "panel") refreshProps();
}
function shotDialog(name, creating) {
  if (creating) {
    const box = modal("New shot", "small");
    const n = h("input", { placeholder: "ch1_s01" }), s = h("input", { placeholder: "Re:Zero (used when a line has no series)" });
    const c = h("textarea", { rows: 5, style: "flex:1;font:13px/1.5 ui-monospace,Menlo,monospace", placeholder: "Rem | Re:Zero\nRam | Re:Zero\nEmilia" });
    $(".mbody", box).append(h("div", { class: "form" }, rowOf("Folder name", n), rowOf("Characters", c), rowOf("Series", s),
      h("p", { class: "hint" }, "One character per line, left to right as they stand in the frame. \"Name | Series\" or just a name. " +
        "Each gets lora: auto, so its LoRA is looked up on Civitai and downloaded on the pod when you render. " +
        "Then pose in CharaStudio: F11 the characters, swap each to the OpenPose card, F11 again, and use Grab from Studio.")));
    box.append(h("div", { class: "mfoot" }, h("button", { onclick: closeModal }, "Cancel"), h("button", { class: "primary", onclick: async () => {
      const chars = c.value.split(/[\n,]/).map(x => x.trim()).filter(Boolean).map(line => {
        const [name, series] = line.split("|").map(x => x.trim());
        return { name, series: series || s.value.trim() };
      });
      if (!chars.length) return toast("Add at least one character", "err");
      try { await post("/api/shot/new", { name: n.value.trim(), characters: chars }); await loadShots(); shotDialog(n.value.trim()); }
      catch (e) { toast(e.message, "err"); }
    } }, "Create")));
    setTimeout(() => n.focus(), 0);
    return;
  }
  const box = modal("Shots", "");
  let cur = name || S.shots[0]?.name;
  const listEl = h("div", { class: "shotlist" }), mid = h("div"), prev = h("div", { class: "shotprev" });
  $(".mbody", box).append(h("div", { class: "shotedit" }, listEl, mid, prev));
  const foot = h("div", { class: "mfoot" }); box.append(foot);
  const show = () => {
    listEl.innerHTML = ""; mid.innerHTML = ""; prev.innerHTML = ""; foot.innerHTML = "";
    for (const s of S.shots) listEl.append(h("div", { class: s.name === cur ? "on" : "", onclick: () => { cur = s.name; show(); } }, s.name));
    listEl.append(h("button", { style: "margin-top:8px;width:100%", onclick: () => shotDialog(null, true) }, "＋ New shot"));
    const s = S.shots.find(q => q.name === cur);
    if (!s) { mid.append(h("p", { class: "hint" }, "No shots yet.")); return; }
    const ta = h("textarea", { value: s.yaml, spellcheck: false });
    mid.append(h("div", { class: "hint", style: "margin-top:0" }, `shots/${s.name}/${s.sidecar || "shot.yaml"} — prompt, characters, style (${S.cat.styles.join(", ")}), seed…`), ta);
    const imgBlock = (ref, label) => ref ? [h("img", { src: thumb(ref, 600) }), h("div", { class: "lbl" }, label)] : [h("div", { class: "lbl" }, label + ": none")];
    prev.append(...imgBlock(s.renders[0], "Latest render"), ...imgBlock(s.pose, "Pose (OpenPose capture)"), ...imgBlock(s.reference, "Reference"));
    const seed = h("input", { type: "number", placeholder: "seed (random)", style: "width:140px" });
    const saveY = async () => { await post("/api/shot/yaml", { name: s.name, yaml: ta.value }); s.yaml = ta.value; };
    foot.append(
      h("button", { onclick: async () => {
        if (!confirm(`Copy the two newest F11 renders from UserData/cap into ${s.name}?\nNewest = pose.png, the one before = reference.png (overwrites).`)) return;
        startJob({ cmd: "grab", shot: s.name });
      } }, "Grab from Studio"),
      h("div", { class: "spacer" }), seed,
      h("button", { onclick: async () => { try { await saveY(); toast("Saved", "ok"); } catch (e) { toast(e.message, "err"); } } }, "Save"),
      h("button", { class: "primary", disabled: !s.pose, onclick: async () => {
        try { await saveY(); renderShot(s.name, seed.value); closeModal(); } catch (e) { toast(e.message, "err"); }
      } }, "Save & render on pod"),
      selL()?.type === "panel" && s.renders[0] ? h("button", { onclick: () => { setPanelImage(selL(), s.renders[0], s.name); closeModal(); } }, "Use in selected panel") : null);
  };
  show();
}

/* ================================================================ jobs & pod */
async function startJob(body) {
  try {
    const r = await post("/api/jobs", body);
    S.jobs[r.id] = { id: r.id, label: body.cmd === "pod" ? "pod " + body.action : `${body.cmd} ${body.shot}`, lines: [], next: 0, done: false, body };
    S.jobView = r.id; toggleJobs(true); pollJobs();
    return r.id;
  } catch (e) { toast(e.message, "err"); }
}
function renderShot(name, seed) {
  if (S.pod && !S.pod.running) toast("The pod isn't running: Pipeline › Start pod first", "err");
  startJob({ cmd: "run", shot: name, seed: seed || undefined });
}
function podAction(a) {
  if (a === "stop" && !confirm("Stop the RunPod pod? GPU billing stops; models stay on the volume.")) return;
  startJob({ cmd: "pod", action: a });
}
let pollT = null;
async function pollJobs() {
  clearTimeout(pollT);
  let active = false;
  for (const j of Object.values(S.jobs)) {
    if (j.done) continue;
    active = true;
    try {
      const r = await api(`/api/jobs/${j.id}?since=${j.next}`);
      j.lines.push(...r.lines); j.next = r.next;
      if (r.done) {
        j.done = true; j.code = r.code;
        toast(`${j.label}: ${r.code === 0 ? "done" : "failed"}`, r.code === 0 ? "ok" : "err");
        if (["run", "render", "grab"].includes(j.body.cmd)) await afterRender(j.body.shot, j.body.cmd !== "grab");
        if (j.body.cmd === "pod") refreshPod(true);
      }
    } catch (e) { j.done = true; j.lines.push("error: " + e.message); }
  }
  renderJobs();
  $("#jobsbtn").classList.toggle("busy", active);
  $("#jobsbtn").textContent = active ? "Jobs (running…)" : "Jobs";
  if (active) pollT = setTimeout(pollJobs, 1000);
}
async function afterRender(shot, fillPanels) {
  await loadShots();
  const s = S.shots.find(q => q.name === shot);
  if (!fillPanels || !s?.renders[0]) return;
  let n = 0;
  for (const pg of S.doc.pages) for (const l of pg.layers) if (l.type === "panel" && l.shot === shot && (!l.image || !l.lockImage)) {
    const keep = l.image ? { fit: l.image.fit, focus: l.image.focus, zoom: l.image.zoom, flip: l.image.flip } : null;
    const dim = await imgSize(s.renders[0]);
    l.image = { ref: s.renders[0], iw: dim.w, ih: dim.h, fit: "cover", focus: [0.5, 0.3], zoom: 1, flip: false, ...(keep || {}) }; n++;
  }
  if (n) { commit(`New render placed in ${n} panel${n > 1 ? "s" : ""}`); requestDraw(); renderPageThumbs(); }
}
function toggleJobs(show) { $("#jobsdrawer").hidden = !(show ?? $("#jobsdrawer").hidden); renderJobs(); }
$("#jobsbtn").onclick = () => toggleJobs();
$("#jobsclose").onclick = () => toggleJobs(false);
function renderJobs() {
  if ($("#jobsdrawer").hidden) return;
  const list = $("#joblist"); list.innerHTML = "";
  const js = Object.values(S.jobs);
  if (!js.length) { list.append(h("span", { class: "hint" }, "No jobs yet. Renders and pod commands show their log here.")); $("#joblog").textContent = ""; return; }
  for (const j of js.reverse()) list.append(h("button", { class: j.id === S.jobView ? "on" : "", onclick: () => { S.jobView = j.id; renderJobs(); } },
    (j.done ? (j.code === 0 ? "✓ " : "✕ ") : "… ") + j.label));
  const j = S.jobs[S.jobView] || js[0], pre = $("#joblog");
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  pre.textContent = j.lines.join("\n") || "starting…";
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
async function refreshPod(force) {
  const pill = $("#podpill");
  if (force) { pill.textContent = "pod: checking…"; pill.className = "pill"; }
  try {
    S.pod = await api("/api/pod");
    const p = S.pod;
    pill.className = "pill " + (p.ready ? "ok" : p.running ? "warn" : "off");
    pill.textContent = p.target !== "runpod" ? `local ComfyUI` : p.ready ? "pod ready" : p.running ? "pod starting" : (p.text.match(/: (\w+)/)?.[1] || "pod off").toLowerCase();
    pill.title = p.text;
  } catch (e) { pill.textContent = "pod ?"; pill.title = e.message; }
}
$("#podpill").onclick = e => {
  const r = e.target.getBoundingClientRect();
  popMenu(r.right - 240, r.bottom + 4, [[S.pod?.text || "status unknown", () => {}, "", true], null, ["Refresh", () => refreshPod(true)],
    ["Open ComfyUI", () => window.open(S.pod.url, "_blank"), "", !S.pod?.url], ["Start pod", () => podAction("start")], ["Stop pod", () => podAction("stop")]]);
};

/* ================================================================ save / open / export */
function setName(n) { S.name = n; $("#docname").textContent = n ? `${n}${S.dirty ? " •" : ""}` : "unsaved"; document.title = (n || "Untitled") + " — MangaMaker"; }
async function save(as) {
  let n = S.name;
  if (!n || as) { n = prompt("Project name (saved to MangaPipeline/pages/<name>/project.json)", n || S.doc.title.replace(/[^\w\- .]/g, "_")); if (!n) return; }
  try { await post(`/api/project?name=${encodeURIComponent(n)}`, S.doc); S.dirty = false; setName(n); toast("Saved " + n, "ok"); localStorage.setItem("mm.last", n); }
  catch (e) { toast(e.message, "err"); }
}
async function openProject(n) {
  try {
    const doc = await api(`/api/project?name=${encodeURIComponent(n)}`);
    loadDoc(normalize(doc), n); localStorage.setItem("mm.last", n);
  } catch (e) { toast(e.message, "err"); }
}
function loadDoc(doc, name) {
  S.doc = doc; S.page = 0; S.sel = null; S.undo = []; S.redo = []; S.adjust = null; snapshot(); S.dirty = false;
  setName(name || ""); refreshPanels(); renderPages(); fitView(); status("");
}
function newProject() {
  if (S.dirty && !confirm("Discard unsaved changes?")) return;
  loadDoc(newDoc(), ""); layoutDialog();
}
async function openDialog() {
  const ps = await api("/api/projects").catch(() => []);
  const box = modal("Open project", "small");
  const body = $(".mbody", box);
  if (!ps.length) body.append(h("p", { class: "hint" }, "No saved projects yet."));
  for (const p of ps) body.append(h("div", { class: "row" }, h("button", { style: "flex:1;text-align:left", onclick: () => { closeModal(); openProject(p); } }, p)));
}
async function importDialog() {
  const box = modal("Import a page script", "small"), body = $(".mbody", box);
  body.append(h("p", { class: "hint" }, "Turns a scripts/*.yaml (the one `mangapipe page` builds) into an editable project: layouts, renders, crops and dialogue."));
  for (const sc of S.cat.scripts) body.append(h("div", { class: "row" }, h("button", { style: "flex:1;text-align:left", onclick: async () => {
    try {
      const d = await post(`/api/import?script=${encodeURIComponent(sc)}`);
      const doc = normalize({ ...newDoc(d.title), ...d, pages: d.pages.map(p => ({ id: uid(), bg: "#ffffff", layers: p.layers })) });
      closeModal(); loadDoc(doc, ""); toast(`Imported ${sc}`, "ok");
    } catch (e) { toast(e.message, "err"); }
  } }, sc)));
}
async function renderFull(i) {
  const c = document.createElement("canvas"); c.width = W(); c.height = H();
  const g = c.getContext("2d");
  await document.fonts.ready;
  for (let k = 0; k < 3; k++) { drawPage(g, S.doc.pages[i], { export: true, rs: 1 }); await waitImages(); }
  drawPage(g, S.doc.pages[i], { export: true, rs: 1 });
  return c;
}
async function exportPages(which) {
  if (!S.name) { await save(); if (!S.name) return; }
  const idx = which === "all" ? S.doc.pages.map((_, i) => i) : [S.page];
  status("Exporting…");
  try {
    for (const i of idx) {
      const c = await renderFull(i);
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      await post(`/api/export/page?name=${encodeURIComponent(S.name)}&n=${i + 1}`, blob, true);
    }
    let msg = `Exported ${idx.length} page${idx.length > 1 ? "s" : ""} to pages/${S.name}/`;
    if (which === "all") { await post(`/api/export/pdf?name=${encodeURIComponent(S.name)}&count=${S.doc.pages.length}`); msg += ` + ${S.name}.pdf`; }
    toast(msg, "ok"); status(msg);
  } catch (e) { toast(e.message, "err"); }
}
async function downloadPage() {
  const c = await renderFull(S.page);
  const a = h("a", { href: c.toDataURL("image/png"), download: `${S.name || "page"}_${String(S.page + 1).padStart(2, "0")}.png` }); a.click();
}
setInterval(() => { if (S.doc && S.dirty) try { localStorage.setItem("mm.autosave", JSON.stringify({ name: S.name, doc: S.doc })); } catch { } }, 5000);
addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

/* ================================================================ misc */
function refreshPanels() { refreshProps(); renderLayers(); setName(S.name); schedThumbs(); }
function status(m) { $("#st-msg").textContent = m || ""; }
function toast(m, kind) {
  const t = h("div", { class: "toast " + (kind || "") }, m); $("#toasts").append(t); setTimeout(() => t.remove(), kind === "err" ? 6000 : 3000);
}
new ResizeObserver(resize).observe(stage);

/* ================================================================ boot */
(async function boot() {
  buildMenus(); buildToolbar();
  status("Loading templates (first start indexes 104 bubbles and 100 layouts)…");
  S.cat = await api("/api/catalog");
  S.shots = await api("/api/shots").catch(() => []);
  status("");
  setTool("move"); renderLibrary();
  const last = localStorage.getItem("mm.last");
  let auto = null; try { auto = JSON.parse(localStorage.getItem("mm.autosave") || "null"); } catch { }
  if (auto?.doc && confirm("Restore the unsaved work from your last session?")) { loadDoc(normalize(auto.doc), auto.name); S.dirty = true; setName(auto.name); }
  else if (last && (await api("/api/projects").catch(() => [])).includes(last)) await openProject(last);
  else {
    const doc = newDoc("Chapter 1");
    const L = S.cat.layouts.find(l => l.n === 13) || S.cat.layouts[0];
    loadDoc(doc, "");
    if (L) applyLayout(L.rects, "#" + L.n); else applyLayout(gridRects(...PRESET_LAYOUTS[6].slice(1)), PRESET_LAYOUTS[6][0]);
    S.undo = []; S.dirty = false; setName("");
  }
  localStorage.removeItem("mm.autosave");
  refreshPod(); setInterval(refreshPod, 30000);
})().catch(e => { toast("Startup failed: " + e.message, "err"); console.error(e); });

/* Properties and Layers fold away from their headers, so the library can take the whole dock */
for (const id of ["propspanel", "layerspanel"]) {
  const panel = $("#" + id);
  try { if (localStorage.getItem("mm.fold." + id) === "1") panel.classList.add("collapsed"); } catch { }
  $(".dockhead", panel).addEventListener("click", e => {
    if (e.target.closest("button")) return;
    panel.classList.toggle("collapsed");
    try { localStorage.setItem("mm.fold." + id, panel.classList.contains("collapsed") ? "1" : "0"); } catch { }
  });
}
