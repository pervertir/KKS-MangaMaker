import { clamp, h } from "./core.js";
import { ieLayer } from "./inline-edit.js";
import { schedThumbs } from "./pages.js";
import { requestDraw } from "./view.js";
import { boxShape, drawLaid, fitLayout } from "../lettering/layout.ts";
import { drawSfx } from "../lettering/sfx.ts";

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
  ["Noto Sans JP", "日本語 · Noto Sans JP (gothic)"], ["Noto Serif JP", "日本語 · Noto Serif JP (mincho, dialogue)"],
  ["M PLUS Rounded 1c", "日本語 · M PLUS Rounded 1c (rounded)"], ["Yuji Syuku", "日本語 · Yuji Syuku (brush)"], ["Kosugi Maru", "日本語 · Kosugi Maru"], ["Zen Kurenaido", "日本語 · Zen Kurenaido (brush)"], ["Kaisei Decol", "日本語 · Kaisei Decol (mincho)"],
  ["Hiragino Sans", "System · Hiragino Sans"], ["Impact", "System · Impact"], ["Arial Black", "System · Arial Black"], ["Georgia", "System · Georgia"]];
export const fontStr = (l, px) => `${l.italic ? "italic " : ""}${l.bold ? "700 " : "400 "}${px}px "${l.font || "MMComic"}", "Comic Sans MS", sans-serif`;
export const MEAS = document.createElement("canvas").getContext("2d");
export const fitCache = new Map();

export const measure = (l) => (t, px) => { MEAS.font = fontStr(l, px); return MEAS.measureText(t).width; };
const textOpts = l => ({ vertical: !!l.vertical, align: l.align, ruby: l.rubySize || undefined, gap: l.lineGap || 0, tracking: l.tracking || 0 });
/* largest size (<= maxPx) whose lines fit maxW x maxH, or the layer's shape when given; fixed size when
   l.fontSize > 0. Returns the layout plus lines/lh for the in-place editor. */
export function fit(text, l, maxW, maxH, maxPx, shape = null) {
  const sh = shape || boxShape(maxW, maxH);
  const key = [text, l.font, l.bold, l.italic, l.fontSize, maxPx, l.vertical, l.align, l.rubySize, l.lineGap, l.tracking, sh.key].join("|");
  if (fitCache.has(key)) return fitCache.get(key);
  const L = fitLayout(String(text), sh, maxPx, l.fontSize > 0 ? l.fontSize : 0, textOpts(l), measure(l));
  const res = { ...L, lh: L.pitch };
  if (fitCache.size > 3000) fitCache.clear();
  fitCache.set(key, res);
  return res;
}
/* Web fonts beyond the three defaults are fetched the first time a layer uses one (the Japanese
   families alone are ~400 KB of CSS), so the editor opens without downloading every face. */
export const LAZY_FONTS = {"Patrick Hand": "family=Patrick+Hand", "Kalam": "family=Kalam:wght@400;700", "Indie Flower": "family=Indie+Flower", "Architects Daughter": "family=Architects+Daughter", "Luckiest Guy": "family=Luckiest+Guy", "Permanent Marker": "family=Permanent+Marker", "Shojumaru": "family=Shojumaru", "Rubik Wet Paint": "family=Rubik+Wet+Paint", "Creepster": "family=Creepster", "Bungee Shade": "family=Bungee+Shade", "Black Ops One": "family=Black+Ops+One", "Rampart One": "family=Rampart+One", "Dela Gothic One": "family=Dela+Gothic+One", "Reggae One": "family=Reggae+One", "RocknRoll One": "family=RocknRoll+One", "Potta One": "family=Potta+One", "Yusei Magic": "family=Yusei+Magic", "Mochiy Pop One": "family=Mochiy+Pop+One", "Hachi Maru Pop": "family=Hachi+Maru+Pop", "Zen Maru Gothic": "family=Zen+Maru+Gothic:wght@400;700", "Kosugi Maru": "family=Kosugi+Maru", "Zen Kurenaido": "family=Zen+Kurenaido", "Kaisei Decol": "family=Kaisei+Decol:wght@400;700", "Noto Sans JP": "family=Noto+Sans+JP:wght@400;700;900", "Noto Serif JP": "family=Noto+Serif+JP:wght@400;700", "M PLUS Rounded 1c": "family=M+PLUS+Rounded+1c:wght@400;700", "Yuji Syuku": "family=Yuji+Syuku"};
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
export function drawText(ctx, l, cx, cy, maxW, maxH, maxPx, color, shape = null) {
  const text = l.text || "";
  ensureFont(l);
  if (ieLayer && l.id === ieLayer.id) return;      // being typed: the in-place editor shows this text itself
  if (!text.trim()) return;
  const f = fit(text, l, maxW, maxH, maxPx, shape);
  drawLaid(ctx, f, cx, cy, { fill: color, stroke: l.stroke, strokeW: l.strokeWidth || 0, paper: l.paper, paperW: l.paperW || 0, font: px => fontStr(l, px) }, !!l.vertical);
}
/* SFX: on a baseline when one is set, with the rough / trail / double outline treatments */
export function drawSfxText(ctx, l, maxPx, color) {
  ensureFont(l);
  if (ieLayer && l.id === ieLayer.id) return;
  if (!(l.text || "").trim()) return;
  drawSfx(ctx, l, maxPx, color, measure(l), px => fontStr(l, px));
}
