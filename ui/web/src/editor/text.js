import { clamp, h } from "./core.js";
import { ieLayer } from "./inline-edit.js";
import { schedThumbs } from "./pages.js";
import { requestDraw } from "./view.js";

/* ================================================================ text */
export const FONTS = [
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
export const fontStr = (l, px) => `${l.italic ? "italic " : ""}${l.bold ? "700 " : "400 "}${px}px "${l.font || "MMComic"}", "Comic Sans MS", sans-serif`;
export const MEAS = document.createElement("canvas").getContext("2d");
export const fitCache = new Map();

export function wrap(text, l, px, maxW) {
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
export function fit(text, l, maxW, maxH, maxPx) {
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
/* Web fonts beyond the three defaults are fetched the first time a layer uses one (the Japanese
   families alone are ~400 KB of CSS), so the editor opens without downloading every face. */
export const LAZY_FONTS = {"Patrick Hand": "family=Patrick+Hand", "Kalam": "family=Kalam:wght@400;700", "Indie Flower": "family=Indie+Flower", "Architects Daughter": "family=Architects+Daughter", "Luckiest Guy": "family=Luckiest+Guy", "Permanent Marker": "family=Permanent+Marker", "Shojumaru": "family=Shojumaru", "Rubik Wet Paint": "family=Rubik+Wet+Paint", "Creepster": "family=Creepster", "Bungee Shade": "family=Bungee+Shade", "Black Ops One": "family=Black+Ops+One", "Rampart One": "family=Rampart+One", "Dela Gothic One": "family=Dela+Gothic+One", "Reggae One": "family=Reggae+One", "RocknRoll One": "family=RocknRoll+One", "Potta One": "family=Potta+One", "Yusei Magic": "family=Yusei+Magic", "Mochiy Pop One": "family=Mochiy+Pop+One", "Hachi Maru Pop": "family=Hachi+Maru+Pop", "Zen Maru Gothic": "family=Zen+Maru+Gothic:wght@400;700", "Kosugi Maru": "family=Kosugi+Maru", "Zen Kurenaido": "family=Zen+Kurenaido", "Kaisei Decol": "family=Kaisei+Decol:wght@400;700"};
export const fontLinks = new Map();
export function loadFontCss(family) {
  const q = LAZY_FONTS[family]; if (!q || fontLinks.has(family)) return fontLinks.get(family) || Promise.resolve();
  const pr = new Promise(res => {
    const ln = h("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?${q}&display=swap` });
    ln.onload = ln.onerror = () => res(); document.head.append(ln);
  });
  fontLinks.set(family, pr); return pr;
}
export const fontsAsked = new Set();
export function ensureFont(l) {
  const f = fontStr(l, 40);
  if (fontsAsked.has(f)) return;
  fontsAsked.add(f);
  loadFontCss(l.font).then(() => document.fonts.load(f, "あA")).then(() => { fitCache.clear(); requestDraw(); schedThumbs(); });
}
export function drawText(ctx, l, cx, cy, maxW, maxH, maxPx, color) {
  const text = l.text || "";
  ensureFont(l);
  if (ieLayer && l.id === ieLayer.id) return;      // being typed: the in-place editor shows this text itself
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
