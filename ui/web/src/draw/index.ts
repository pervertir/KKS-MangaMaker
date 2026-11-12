import { onBlobLoad } from "./blobs.ts";
import { alphaAt, pageScale, toLocal } from "./raster.ts";
import { drawPaint } from "./render.ts";
import { BRUSHES, DS, INK_PENS, SWATCHES, curBrush, curInk, resetBrush, resetInk, saveDS, type Brush, type InkPen } from "./settings.ts";
import { fillAt, strokeCancel, strokeDown, strokeMove, strokeUp } from "./tool.ts";
import { itemAt } from "./vector.ts";
import { bumpRenderEpoch } from "../core/layer-cache.ts";
import { defineLayerType } from "../core/registry.ts";
import type { StabilizerSpec } from "../core/input.ts";
import { registerTool, type ToolEvent } from "../core/tools.ts";
import { h } from "../editor/core.js";
import { renderLayers } from "../editor/layers.js";
import { renderOptions } from "../editor/options.js";
import { schedThumbs } from "../editor/pages.js";
import { S } from "../editor/state.ts";
import { requestDraw, requestView } from "../editor/view.js";
import type { Layer } from "../types.ts";

/* ---------------------------------------------------------------- layer types */
function paintDefaults(l: Layer) {
  l.ow ||= Math.round(l.w); l.oh ||= Math.round(l.h); l.clip ??= null;
  if (l.type === "raster") l.tiles ||= {}; else l.items ||= [];
}
/* paint and line art cover their whole panel, so only what was actually drawn picks them */
function paintHit(l: Layer, x: number, y: number): boolean {
  const q = toLocal(l, { x, y });
  if (q.x < 0 || q.y < 0 || q.x > l.ow || q.y > l.oh) return false;
  const pad = 4 / S.view.s / pageScale(l);
  if (l.type === "vector") return itemAt(l, q.x, q.y, pad) >= 0;
  return [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]].some(([dx, dy]) => alphaAt(l, q.x + dx, q.y + dy) > 24);
}
defineLayerType({ type: "raster", label: "Paint", defaults: paintDefaults, draw: (ctx, l) => drawPaint(ctx, l), hit: paintHit });
defineLayerType({ type: "vector", label: "Line art", defaults: paintDefaults, draw: (ctx, l) => drawPaint(ctx, l), hit: paintHit });
onBlobLoad(() => { bumpRenderEpoch(); requestDraw(); schedThumbs(true); renderLayers(); });

/* ---------------------------------------------------------------- options bar */
const field = (label: string, el: HTMLElement, title = "") => h("label", { class: "dopt", title }, h("span", {}, label), el);
function range(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => String(v), title = "") {
  const out = h("span", { class: "val" }, fmt(get()));
  const r = h("input", { type: "range", min, max, step, value: get(), oninput: (e: Event) => {
    const v = +(e.target as HTMLInputElement).value; set(v); out.textContent = fmt(v);
  }, onchange: () => { saveDS(); requestView(); } });
  return h("span", { class: "dopt", title }, h("span", {}, label), r, out);
}
const select = (opts: [string, string][], cur: string, pick: (v: string) => void, title = "") =>
  h("select", { title, onchange: (e: Event) => { pick((e.target as HTMLSelectElement).value); saveDS(); renderOptions(); } },
    ...opts.map(([v, t]) => h("option", { value: v, selected: v === cur }, t)));
const seg = (opts: [string, string, string][], cur: string, pick: (v: string) => void) => h("div", { class: "seg" },
  ...opts.map(([k, t, tip]) => h("button", { class: cur === k ? "on" : "", title: tip, onclick: () => { pick(k); saveDS(); renderOptions(); } }, t)));
function colour() {
  const well = h("input", { type: "color", value: DS.color, title: "Colour", oninput: (e: Event) => { DS.color = (e.target as HTMLInputElement).value; }, onchange: () => { saveDS(); renderOptions(); } });
  const sw = h("div", { class: "swatches" }, ...SWATCHES.map(c => h("button", { class: "sw" + (c === DS.color ? " on" : ""), title: c, style: `background:${c}`,
    onclick: () => { DS.color = c; saveDS(); renderOptions(); } })));
  return h("span", { class: "dopt" }, well, sw);
}
function stabilizerOpts() {
  const out = [seg([["none", "Off", "No stabilizer"], ["smooth", "Smooth", "Averages the last few samples"], ["rope", "Rope", "The line trails the pen on a string: very steady lines"]],
    DS.stab, v => { DS.stab = v as typeof DS.stab; })];
  if (DS.stab !== "none") out.push(range("", 1, 20, 1, () => DS.stabAmount, v => { DS.stabAmount = v; }, v => String(v), "Stabilizer strength"));
  return out;
}
const sizeRange = (o: { size: number }, max = 300) => range("Size", 1, max, 1, () => o.size, v => { o.size = v; }, v => v + "px");
const pressure = () => range("Pressure", 0.3, 2.5, 0.05, () => DS.curve, v => { DS.curve = v; }, v => v < 0.95 ? "soft" : v > 1.05 ? "firm" : "linear", "Pen pressure curve");

export function stabSpec(): StabilizerSpec {
  if (DS.stab === "smooth") return { kind: "average", window: Math.max(2, DS.stabAmount) };
  if (DS.stab === "rope") return { kind: "rope", length: DS.stabAmount * 3 };
  return { kind: "none" };
}

/* ---------------------------------------------------------------- tools */
let ring: { x: number; y: number } | null = null;
const track = (e: ToolEvent) => { ring = e.raw; };
function drawRing(r: number) {
  return (ctx: CanvasRenderingContext2D, px: number) => {
    if (!ring || r <= 0) return;
    ctx.save(); ctx.lineWidth = px;
    ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(ring.x, ring.y, Math.max(r, 2 * px) + px, 0, 7); ctx.stroke();
    ctx.strokeStyle = "#000"; ctx.beginPath(); ctx.arc(ring.x, ring.y, Math.max(r, 2 * px), 0, 7); ctx.stroke();
    ctx.restore();
  };
}
const ICON = {
  brush: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 4L10 14"/><path d="M10 14c-2-1-4 0-4.5 2S4.6 20 3 20.5c3 .8 6.8.2 7.8-2.3.6-1.6.2-3-0.8-4.2z" fill="currentColor"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 16l9-9 6 6-7 7H8z"/><path d="M9 11l6 6M12 20h8"/></svg>',
  ink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14.5 3.5l6 6-9 9-5 1.5 1.5-5z"/><path d="M6.5 19.5L3 21"/><circle cx="13" cy="11" r="1.4" fill="currentColor"/></svg>',
  fill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M11 3l8 8-7 7-8-8z"/><path d="M4 10h15"/><path d="M20 15s2 2.6 2 4a2 2 0 01-4 0c0-1.4 2-4 2-4z" fill="currentColor"/></svg>',
};

registerTool({
  id: "brush", label: "Brush", key: "n", icon: ICON.brush, group: "draw", cursor: "crosshair",
  stabilizer: stabSpec, hover: track,
  down: e => { track(e); strokeDown(e, "brush"); }, move: e => { track(e); strokeMove(e); }, up: strokeUp, cancel: strokeCancel,
  overlay: (ctx, px) => drawRing(curBrush().size / 2)(ctx, px),
  options(bar) {
    const b = curBrush();
    bar.append(
      select(Object.entries(BRUSHES).map(([k, v]) => [k, v.name]), DS.brush, v => { DS.brush = v; }, "Brush"),
      sizeRange(b), range("Opacity", 0.05, 1, 0.05, () => b.opacity, v => { b.opacity = v; }, v => Math.round(v * 100) + "%"),
      colour(), ...stabilizerOpts(), pressure(),
      h("button", { class: "ghost", title: "Back to this brush's defaults", onclick: () => { resetBrush(); renderOptions(); } }, "Reset"));
  },
});
registerTool({
  id: "eraser", label: "Eraser", key: "e", icon: ICON.eraser, group: "draw", cursor: "crosshair",
  hover: track, down: e => { track(e); strokeDown(e, "eraser"); }, move: e => { track(e); strokeMove(e); }, up: strokeUp, cancel: strokeCancel,
  overlay: (ctx, px) => drawRing(DS.eraser.size / 2)(ctx, px),
  options(bar) {
    const b: Brush = DS.eraser;
    bar.append(sizeRange(b), range("Hardness", 0, 1, 0.05, () => b.hardness, v => { b.hardness = v; }, v => Math.round(v * 100) + "%"),
      h("span", { class: "dopt" }, h("span", {}, "Line art"), seg([["stroke", "Whole line", "Removes every line the eraser touches"],
        ["intersect", "To crossing", "Removes the touched part of a line up to where it crosses other lines"],
        ["partial", "Partial", "Cuts lines only where the eraser passes"]], DS.verase, v => { DS.verase = v as typeof DS.verase; })));
  },
});
registerTool({
  id: "ink", label: "Line art", key: "i", icon: ICON.ink, group: "draw", cursor: "crosshair",
  stabilizer: stabSpec, hover: track,
  down: e => { track(e); strokeDown(e, "ink"); }, move: e => { track(e); strokeMove(e); }, up: strokeUp, cancel: strokeCancel,
  overlay: (ctx, px) => drawRing(curInk().size / 2)(ctx, px),
  options(bar) {
    const k: InkPen = curInk();
    bar.append(
      select(Object.entries(INK_PENS).map(([v, p]) => [v, p.name]), DS.ink, v => { DS.ink = v; }, "Pen"),
      sizeRange(k, 80), range("Thinning", 0, 0.95, 0.05, () => k.thinning, v => { k.thinning = v; }, v => Math.round(v * 100) + "%", "How much pressure (or speed, with a mouse) thins the line"),
      range("Taper", 0, 200, 1, () => Math.min(200, k.taper[1]), v => { k.taper = [Math.round(v * 0.6), v]; }, v => v + "px", "Length of the thin start and end"),
      colour(), ...stabilizerOpts(), pressure(),
      h("button", { class: "ghost", title: "Back to this pen's defaults", onclick: () => { resetInk(); renderOptions(); } }, "Reset"));
  },
});
registerTool({
  id: "fill", label: "Fill bucket", key: "k", icon: ICON.fill, group: "draw", cursor: "crosshair",
  down: e => { fillAt(e.raw); },
  options(bar) {
    bar.append(colour(),
      range("Close gaps", 0, 8, 1, () => DS.gap, v => { DS.gap = v; }, v => v + "px", "Gaps in the line art up to this wide still hold the fill"),
      range("Tolerance", 0, 160, 4, () => DS.tolerance, v => { DS.tolerance = v; }, v => String(v), "How different a colour can be and still count as the same area"));
  },
});
