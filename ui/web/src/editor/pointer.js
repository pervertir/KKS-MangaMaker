import { exitAdjust } from "./adjust.js";
import { $, clamp } from "./core.js";
import { imageRect } from "./drawing.js";
import { commit } from "./history.js";
import { hitLayer } from "./hit.js";
import { hideInline, placeInline } from "./inline-edit.js";
import { layerMenu } from "./layers.js";
import { popMenu } from "./menus.js";
import { refreshPanels } from "./misc.js";
import { refreshProps } from "./props.js";
import { S, layers } from "./state.ts";
import { getTool } from "../core/tools.ts";
import { samplesOf, stabilizer } from "../core/input.ts";
import { cv, interacting, requestDraw, requestView, stage, toPage, zoomAt, set_DC } from "./view.js";

/* ================================================================ pointer */
/* The canvas listens here and hands every event to the active tool (core/tools.ts; the built-in ones are in
   builtin-tools.js). Panning (Space, middle button) and repositioning a panel's render work under any tool. */
export let spaceDown = false;
export function set_spaceDown(v) { spaceDown = v; }

export function startPan(e) {
  const r = cv.getBoundingClientRect();
  S.drag = { pan: true, sx: e.clientX - r.left, sy: e.clientY - r.top, tx: S.view.tx, ty: S.view.ty }; stage.classList.add("grabbing");
}

let toolStroke = null;
function toolEvent(e, samples) {
  return { samples, raw: samples[samples.length - 1], shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey, button: e.button, native: e };
}
function routeToTool(kind, e) {
  const t = getTool(S.tool);
  if (!t) return false;
  const raw = samplesOf(e, toPage, cv.getBoundingClientRect());
  if (kind === "down") {
    const spec = typeof t.stabilizer === "function" ? t.stabilizer() : t.stabilizer;
    toolStroke = { tool: t, stab: spec ? stabilizer(spec) : null };
  }
  const st = toolStroke?.tool === t ? toolStroke : null;
  if (kind === "move" && !st) {
    cv.style.cursor = spaceDown ? "grab" : t.cursor || "crosshair";
    t.hover?.(toolEvent(e, raw));
    if (t.overlay) requestView();
    return true;
  }
  if (!st) return true;
  let samples = st.stab ? raw.flatMap(s => st.stab.push(s)) : raw;
  if (kind === "up" && st.stab) samples = [...samples, ...st.stab.flush()];
  const ev = { ...toolEvent(e, samples.length ? samples : raw.slice(-1)), raw: raw[raw.length - 1] };
  if (kind === "down") t.down?.(ev); else if (kind === "move") { if (samples.length) t.move?.(ev); } else { toolStroke = null; t.up?.(ev); S.guides = []; }
  if (t.overlay) requestView();
  return true;
}
export function cancelToolStroke() { if (toolStroke) { toolStroke.tool.cancel?.(); toolStroke = null; S.drag = null; S.guides = []; requestDraw(); } }

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_pointer() {
  cv.addEventListener("contextmenu", e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), hit = hitLayer(toPage(e.clientX - r.left, e.clientY - r.top));
    if (hit) { S.sel = hit.id; refreshPanels(); requestDraw(); }
    popMenu(e.clientX, e.clientY, layerMenu());
  });

  cv.addEventListener("pointerdown", e => {
    if (!S.doc) return;
    if (e.button === 2) return;
    hideInline(true);
    try { cv.setPointerCapture(e.pointerId); } catch { }
    const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
    if (e.button === 1 || spaceDown) { startPan(e); return; }
    if (S.adjust) {
      const pl = layers().find(l => l.id === S.adjust);
      if (pl && pl.image && hitLayer(p, l => l.id === pl.id)) {
        S.drag = { adjust: pl, layer: pl, p0: p, f0: [...(pl.image.focus || [0.5, 0.5])] }; return;
      }
      exitAdjust();
    }
    routeToTool("down", e);
  });

  cv.addEventListener("pointermove", e => {
    const r = cv.getBoundingClientRect(), sp = { x: e.clientX - r.left, y: e.clientY - r.top }, p = toPage(sp.x, sp.y);
    $("#st-pos").textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
    const d = S.drag;
    if (d?.pan) { S.view.tx = d.tx + sp.x - d.sx; S.view.ty = d.ty + sp.y - d.sy; interacting(); requestView(); return; }
    if (d?.adjust) {
      const l = d.adjust;
      const rr = imageRect(l), dx = p.x - d.p0.x, dy = p.y - d.p0.y, fl = l.image.flip ? -1 : 1;
      const hx = l.w / 2 / rr.w, hy = l.h / 2 / rr.h;
      l.image.focus = [clamp(d.f0[0] - fl * dx / rr.w, hx, 1 - hx), clamp(d.f0[1] - dy / rr.h, hy, 1 - hy)].map(v => +v.toFixed(4));
      if (l.image.fit === "contain") l.image.focus = d.f0;
      requestDraw(); return;
    }
    if (!d && S.adjust) { cv.style.cursor = "move"; return; }
    if (!d && spaceDown) { cv.style.cursor = "grab"; return; }
    routeToTool("move", e);
  });

  const end = e => {
    const d = S.drag;
    if (d?.pan || d?.adjust) {
      S.drag = null; S.guides = []; set_DC(null); stage.classList.remove("grabbing"); requestDraw();
      if (d.adjust) commit("Image moved");
      return;
    }
    if (e.type === "pointercancel") { cancelToolStroke(); return; }
    routeToTool("up", e);
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);

  cv.addEventListener("dblclick", e => {
    const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
    getTool(S.tool)?.dblclick?.(p, e);
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
}
