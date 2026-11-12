import { $ } from "./core.js";
import { displayTheme, themed } from "./creation.js";
import { commit } from "./history.js";
import { VTEXT, lum } from "./manga-tools.js";
import { refreshPanels } from "./misc.js";
import { S, bubbleMeta } from "./state.ts";
import { fit, fontStr } from "./text.js";
import { balloonText } from "../lettering/index.ts";
import { requestDraw, toScreen } from "./view.js";

/* ================================================================ inline text editing */
export const ie = $("#inlineedit");
export let ieLayer = null, ieShownAt = 0, ieOrig = "";
export function showInline(l) {
  if (ieLayer && ieLayer !== l) hideInline(true);
  ieLayer = l; ieShownAt = performance.now(); ieOrig = l.text || ""; ie.value = l.text || ""; ie.placeholder = "Type…"; ie.style.display = "block"; placeInline(); requestDraw(); ie.focus(); ie.select();
}
/* Where a layer's text goes and how it is drawn, in page units relative to the layer's centre: the same
   boxes drawLayer uses, so the in-place editor can sit exactly on the text. */
export function textSpec(l) {
  const maxFont = S.doc.maxFont || 56, dark = displayTheme() === "dark"; l = themed(l, displayTheme());
  if (l.type === "bubble") {
    const m = bubbleMeta(l.bubble); let [bx0, by0, bx1, by1] = m.box;
    if (l.flip) [bx0, bx1] = [1 - bx1, 1 - bx0];
    return { dx: -l.w / 2 + (bx0 + bx1) / 2 * l.w, dy: -l.h / 2 + (by0 + by1) / 2 * l.h, w: (bx1 - bx0) * l.w * 0.92, h: (by1 - by0) * l.h * 0.88, maxPx: maxFont,
      color: l.color === "auto" ? (m.dark ? "#ffffff" : "#111111") : l.color, stroke: 0 };
  }
  if (l.type === "balloon") {
    const { sh, color } = balloonText(l);
    return { dx: sh.cx, dy: sh.cy, w: sh.w, h: sh.h, maxPx: maxFont, color, stroke: 0, shape: sh };
  }
  if (l.type === "vbubble") {
    const [fw, fh] = VTEXT[l.shape] || VTEXT.oval;
    return { dx: 0, dy: 0, w: l.w * fw, h: l.h * fh, maxPx: maxFont, color: l.color === "auto" ? (lum(l.fill) > 0.43 ? "#111111" : "#ffffff") : l.color, stroke: 0 };
  }
  if (l.type === "caption") {
    const pad = Math.min(l.w, l.h) * 0.12 + 6;
    return { dx: 0, dy: 0, w: l.w - pad * 2, h: l.h - pad * 2, maxPx: maxFont, color: l.color === "auto" ? (lum(l.fill || "#fff") < 0.45 ? "#ffffff" : "#111") : l.color, stroke: 0 };
  }
  return { dx: 0, dy: 0, w: l.w, h: l.h, maxPx: l.fontSize > 0 ? l.fontSize : Math.max(maxFont, 400),
    color: l.color === "auto" ? (dark ? "#ffffff" : "#111") : l.color, stroke: l.strokeWidth || 0 };
}
/* The editor is the text: transparent, the layer's own font, size, colour, outline, alignment and
   rotation, wrapped in the same box. Only a thin dashed outline marks where the text may go. */
export function placeInline() {
  if (!ieLayer) return;
  const l = ieLayer, v = S.view.s, t = textSpec(l);
  const shown = ie.value || "Type…";
  const f = fit(shown, l, t.w, t.h, t.maxPx, t.shape);
  const c = toScreen(l.x + l.w / 2, l.y + l.h / 2);
  const rot = (l.rotate || 0) * Math.PI / 180, ox = t.dx * Math.cos(rot) - t.dy * Math.sin(rot), oy = t.dx * Math.sin(rot) + t.dy * Math.cos(rot);
  const w = t.w * v, hh = t.h * v, lines = l.vertical ? 1 : f.lines.length;
  const sw = t.stroke * 2 * v;
  Object.assign(ie.style, {
    left: c.x + ox * v - w / 2 + "px", top: c.y + oy * v - hh / 2 + "px", width: w + "px", height: hh + "px",
    transform: l.rotate ? `rotate(${l.rotate}deg)` : "none",
    font: fontStr(l, f.px * v), lineHeight: f.lh * v + "px", color: t.color, caretColor: t.color === "#ffffff" || lum(t.color) > 0.6 ? "#4c8dff" : t.color,
    textAlign: l.vertical ? "start" : (l.align || "center"), writingMode: l.vertical ? "vertical-rl" : "horizontal-tb",
    paddingTop: l.vertical ? "0px" : Math.max(0, (hh - lines * f.lh * v) / 2) + "px",
    webkitTextStroke: sw > 0.2 ? `${sw}px ${l.stroke || "#000"}` : "0", paintOrder: "stroke fill",
  });
}
export function hideInline(save) {
  if (!ieLayer) return;
  const l = ieLayer; ieLayer = null; ie.style.display = "none";
  if (document.activeElement === ie) ie.blur();          // hand the keyboard back to the shortcuts
  l.text = save ? ie.value : ieOrig;
  if (l.text !== ieOrig) commit("Text edited"); else refreshPanels();
  requestDraw();
}

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_inline_edit() {
  ie.addEventListener("input", () => { if (ieLayer) { ieLayer.text = ie.value; placeInline(); requestDraw(); } });

  ie.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); hideInline(true); }
  });

  ie.addEventListener("blur", () => {
    if (ieLayer && performance.now() - ieShownAt < 400) { setTimeout(() => ie.focus(), 0); return; } // the creating click's tail
    hideInline(true);
  });
}
