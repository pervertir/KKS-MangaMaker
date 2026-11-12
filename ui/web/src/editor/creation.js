import { uid } from "./core.js";
import { commit } from "./history.js";
import { hitLayer } from "./hit.js";
import { IMG } from "./images.js";
import { showInline } from "./inline-edit.js";
import { refreshProps } from "./props.js";
import { H, S, W, bubbleMeta, layers, normalize } from "./state.ts";
import { setTool } from "./tools.js";
import { addEffect, currentToneFields, pageSelection, speedFields } from "./effects/apply.ts";
import { contains } from "../core/geometry/region.ts";
import { requestDraw } from "./view.js";
import { newBalloon } from "../lettering/index.ts";
import { applyFrameShape } from "./frames.js";

/* ================================================================ creation */
/* Page theme: ONE switch for the whole editor (Edit > Preferences), applied when drawing, never stored
   in the layers. Dark = black paper, white panel frames, dark empty panels and captions, white lettering
   outside bubbles. Only colours still at a theme default are swapped, so anything coloured by hand stays.
   Export has its own setting (white pages unless changed), so the working view never leaks into a print. */
export const THEMES = {
  light: { bg: "#ffffff", border: "#000000", fill: "#ffffff", ink: "#111111", capFill: "#ffffff", tone: "#000000", empty: ["#e7e7ea", "#c9c9cf", "#8a8a93"] },
  dark: { bg: "#0b0b0d", border: "#ffffff", fill: "#141417", ink: "#ffffff", capFill: "#141417", tone: "#ffffff", empty: ["#1c1c20", "#34343a", "#8a8a93"] },
};
export const PREF = {
  get(k, d) { try { const v = localStorage.getItem("mm.pref." + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem("mm.pref." + k) : localStorage.setItem("mm.pref." + k, v); } catch { } },
};
export const displayTheme = () => PREF.get("darkPages", "0") === "1" ? "dark" : "light";
/* export: "light" (default) | "dark" | "screen" (whatever the editor shows) */
export const exportTheme = () => { const v = PREF.get("exportTheme", "light"); return v === "screen" ? displayTheme() : v === "dark" ? "dark" : "light"; };
export const exportPaper = () => PREF.get("exportPaper", "") || null;       // a custom paper colour for exports, or none
export const themeOf = opt => opt.theme || (opt.export ? exportTheme() : displayTheme());
export const sameCol = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
export function tcol(c, key, T, also = []) {            // a colour at either theme's default becomes this theme's
  return (c == null || sameCol(c, THEMES.light[key]) || sameCol(c, THEMES.dark[key]) || also.some(v => sameCol(c, v))) ? T[key] : c;
}
export function themed(l, name) {                       // the layer as this theme draws it (a copy; the layer is untouched)
  const T = THEMES[name];
  if (l.type === "panel") return { ...l, fill: tcol(l.fill, "fill", T), borderColor: tcol(l.borderColor, "border", T) };
  if (l.type === "caption") return { ...l, fill: tcol(l.fill, "capFill", T) };
  if (l.type === "text" && !l.sfx && l.color !== "auto") return { ...l, color: tcol(l.color, "ink", T, ["#000000", "#111"]) };
  if (l.type === "tone" || l.type === "speed") return { ...l, color: tcol(l.color, "tone", T) };
  return l;
}
export function paperOf(pg, opt = {}) {
  if (opt.export && exportPaper()) return exportPaper();
  return tcol(pg.bg, "bg", THEMES[themeOf(opt)]);
}
export function applyThemeChrome() { document.body.classList.toggle("pages-dark", displayTheme() === "dark"); }
export function addLayer(l, at) {
  normalize({ pages: [{ layers: [l] }] });
  l.id = uid();
  const ls = layers();
  if (at != null) ls.splice(at, 0, l); else ls.push(l);
  S.sel = l.id;
  return l;
}
export function createAt(tool, c, small) {
  let l;
  if (tool === "panel") {
    if (small) return;
    l = addLayer({ type: "panel", x: c.x, y: c.y, w: c.w, h: c.h, shot: "", image: null }, insertIndexForPanel());
    if (S.panelShape !== "rect" && S.panelShape !== "polygon") applyFrameShape(l, S.panelShape);
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
    l = addLayer(newBalloon(S.vshape, cx - w / 2, cy - hh / 2, w, hh));
  } else if (tool === "tone" || tool === "speed") {
    // a click inside the selection fills the selection; otherwise a click fills the panel under it, a drag fills the box
    const props = tool === "tone" ? currentToneFields() : speedFields(), reg = pageSelection();
    if (small && reg && contains(reg, c.x, c.y)) { if (addEffect(tool, props)) setTool("move"); return; }
    const pl = small ? hitLayer(c, q => q.type === "panel") : null;
    const box = pl ? { x: pl.x, y: pl.y, w: pl.w, h: pl.h } : small ? { x: c.x - 300, y: c.y - 300, w: 600, h: 600 } : c;
    if (box.w < 12 || box.h < 12) return;
    if (addEffect(tool, props, box, pl)) setTool("move");
    return;
  } else if (tool === "sfx") {
    const w = small ? 620 : c.w, hh = small ? 260 : Math.max(c.h, 60);
    l = addLayer({ type: "text", sfx: true, x: small ? c.x - w / 2 : c.x, y: small ? c.y - hh / 2 : c.y, w, h: hh, text: "", rotate: -8,
      color: "#ffffff", stroke: "#000000", strokeWidth: 12, font: "Bangers", fontSize: 0 });
  }
  commit("Added " + (l.type === "text" && l.sfx ? "SFX" : l.type === "vbubble" || l.type === "balloon" ? "bubble" : l.type));
  setTool("move");
  requestDraw();
  if (l.type !== "panel") showInline(l);
}
export function insertIndexForPanel() { // panels stay under the lettering
  const ls = layers(); let i = 0;
  ls.forEach((l, k) => { if (l.type === "panel") i = k + 1; });
  return i;
}
export function addImageLayer(ref, iw, ih, at, multiply) {
  const k = Math.min(1, 900 / Math.max(iw, ih)), w = iw * k, hh = ih * k;
  const cx = at ? at.x : W() / 2, cy = at ? at.y : H() / 2;
  const l = addLayer({ type: "image", ref, iw, ih, x: cx - w / 2, y: cy - hh / 2, w, h: hh, blend: multiply ? "multiply" : "source-over" });
  commit("Added image"); requestDraw(); return l;
}
export function setPanelImage(l, ref, shot) {
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
