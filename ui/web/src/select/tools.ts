import { registerTool, type ToolEvent } from "../core/tools.ts";
import { clearSelection, growSelection, modeFromKeys, selection, setSelection } from "../core/selection.ts";
import { ellipse, rect, simplify, subtract, type Pt, type Region } from "../core/geometry/region.ts";
import { floodMask, maskToRegion } from "../core/raster.ts";
import { outlineOf } from "../core/registry.ts";
import { H, S, W, page, selL } from "../editor/state.ts";
import { drawPage } from "../editor/manga-tools.js";
import { requestView } from "../editor/view.js";
import { status } from "../editor/misc.js";

type Mode = "rect" | "ellipse" | "lasso" | "polygon" | "wand";
const opts = { mode: "rect" as Mode, tolerance: 32, contiguous: true };
let drag: { a: Pt; b: Pt; combine: ReturnType<typeof modeFromKeys> } | null = null;
let lasso: Pt[] | null = null, lassoMode: ReturnType<typeof modeFromKeys> = "replace";
let poly: Pt[] | null = null, polyMode: ReturnType<typeof modeFromKeys> = "replace", hoverPt: Pt | null = null, lastDown = 0;

const commitRegion = (r: Region, mode: ReturnType<typeof modeFromKeys>) => { setSelection(r, page().id, mode); requestView(); };
const boxOf = (a: Pt, b: Pt) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });
const shapeOf = (a: Pt, b: Pt): Region => {
  const r = boxOf(a, b);
  return opts.mode === "ellipse" ? ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2) : rect(r.x, r.y, r.w, r.h);
};
function closePoly(): void {
  if (poly && poly.length > 2) commitRegion([poly], polyMode);
  poly = null; hoverPt = null; requestView();
}

/** Magic wand on the composited page, sampled at up to 1600 px so it stays quick; the result is traced to a vector region. */
export function wandRegion(x: number, y: number, tolerance = opts.tolerance, contiguous = opts.contiguous): Region {
  const s = Math.min(1, 1600 / Math.max(W(), H()));
  const c = document.createElement("canvas"); c.width = Math.ceil(W() * s); c.height = Math.ceil(H() * s);
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.setTransform(s, 0, 0, s, 0, 0); drawPage(g, page(), { export: true, rs: s });
  const m = floodMask(g.getImageData(0, 0, c.width, c.height), x * s, y * s, tolerance, contiguous);
  return simplify(maskToRegion(m, 1 / s), 0.6 / s);
}

export const selectAll = () => commitRegion(rect(0, 0, W(), H()), "replace");
export const invertSelection = () => { const r = selection(); commitRegion(r ? subtract(rect(0, 0, W(), H()), r) : rect(0, 0, W(), H()), "replace"); };
export const selectLayerOutline = (mode: ReturnType<typeof modeFromKeys> = "replace") => { const l = selL(); if (l) commitRegion(outlineOf(l), mode); };
export const deselect = () => { clearSelection(); requestView(); };

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.4"><rect x="4" y="5" width="16" height="13" rx="1"/></svg>';

registerTool({
  id: "select", label: "Selection", key: "q", icon: ICON, group: "select", order: 40, cursor: "crosshair",
  deactivate() { drag = null; lasso = null; poly = null; },
  down(e: ToolEvent) {
    const p: Pt = [e.raw.x, e.raw.y], mode = modeFromKeys(e.shift, e.alt);
    if (opts.mode === "wand") { commitRegion(wandRegion(p[0], p[1]), mode); status("Wand: Shift adds, Alt subtracts"); return; }
    if (opts.mode === "lasso") { lasso = [p]; lassoMode = mode; return; }
    if (opts.mode === "polygon") {
      const now = performance.now(), dbl = now - lastDown < 350; lastDown = now;
      if (!poly) { poly = [p]; polyMode = mode; return; }
      const near = Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]) < 10 / S.view.s;
      if (dbl || near) { closePoly(); return; }
      poly.push(p); return;
    }
    drag = { a: p, b: p, combine: mode };
  },
  move(e) {
    const last = e.samples[e.samples.length - 1];
    if (lasso) for (const s of e.samples) { const q = lasso[lasso.length - 1]; if (Math.hypot(s.x - q[0], s.y - q[1]) > 1.5 / S.view.s) lasso.push([s.x, s.y]); }
    if (drag) drag.b = [last.x, last.y];
    if (poly) hoverPt = [last.x, last.y];
  },
  hover(e) { if (poly) { hoverPt = [e.raw.x, e.raw.y]; } },
  up() {
    if (drag) {
      const { a, b, combine } = drag; drag = null;
      if (Math.abs(b[0] - a[0]) < 2 && Math.abs(b[1] - a[1]) < 2) { if (combine === "replace") deselect(); return; }
      commitRegion(shapeOf(a, b), combine);
    }
    if (lasso) { const pts = lasso; lasso = null; if (pts.length > 2) commitRegion(simplify([pts], 0.75 / S.view.s), lassoMode); }
  },
  cancel() { drag = null; lasso = null; poly = null; hoverPt = null; },
  keydown(e) {
    if (e.key === "Enter" && poly) { closePoly(); return true; }
    if (e.key === "Escape") { if (drag || lasso || poly) { drag = null; lasso = null; poly = null; } else deselect(); return true; }
    if ((e.key === "Backspace" || e.key === "Delete") && poly && poly.length > 1) { poly.pop(); return true; }
    return false;
  },
  overlay(ctx, px) {
    ctx.save(); ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = "#4c8dff";
    ctx.beginPath();
    if (drag) {
      const r = boxOf(drag.a, drag.b);
      if (opts.mode === "ellipse") ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); else ctx.rect(r.x, r.y, r.w, r.h);
    }
    const line = lasso || (poly && hoverPt ? [...poly, hoverPt] : poly);
    if (line?.length) { ctx.moveTo(line[0][0], line[0][1]); for (const q of line.slice(1)) ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
    if (poly) { ctx.setLineDash([]); ctx.fillStyle = "#4c8dff"; for (const q of poly) ctx.fillRect(q[0] - 3 * px, q[1] - 3 * px, 6 * px, 6 * px); }
    ctx.restore();
  },
  options(bar) {
    const mk = (tag: string, attrs: Record<string, unknown>, text = "") => { const el = document.createElement(tag); Object.assign(el, attrs); if (text) el.textContent = text; return el; };
    const seg = mk("div", { className: "seg" });
    for (const [k, t] of [["rect", "Rect"], ["ellipse", "Ellipse"], ["lasso", "Lasso"], ["polygon", "Polygon"], ["wand", "Wand"]] as [Mode, string][]) {
      const b = mk("button", { className: opts.mode === k ? "on" : "", onclick: () => { opts.mode = k; poly = null; lasso = null; seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); wand.hidden = k !== "wand"; } }, t) as HTMLButtonElement;
      seg.append(b);
    }
    const wand = mk("span", { hidden: opts.mode !== "wand" });
    const tol = mk("input", { type: "range", min: "0", max: "128", value: String(opts.tolerance), title: "Wand tolerance", oninput: (ev: Event) => { opts.tolerance = +(ev.target as HTMLInputElement).value; } });
    const cont = mk("input", { type: "checkbox", checked: opts.contiguous, title: "Only connected pixels", onchange: (ev: Event) => { opts.contiguous = (ev.target as HTMLInputElement).checked; } });
    wand.append(mk("span", {}, " Tolerance "), tol, mk("label", {}, " Connected "), cont);
    const btn = (t: string, f: () => void, tip: string) => mk("button", { onclick: f, title: tip }, t);
    bar.append(seg, wand,
      btn("All", selectAll, "Select the whole page"), btn("None", deselect, "Deselect"), btn("Invert", invertSelection, "Invert the selection"),
      btn("From layer", () => selectLayerOutline(), "Select the selected layer's outline"),
      btn("Grow", () => { growSelection(4 / Math.max(S.view.s, 0.05)); requestView(); }, "Grow by 4 screen px"),
      btn("Shrink", () => { growSelection(-4 / Math.max(S.view.s, 0.05)); requestView(); }, "Shrink by 4 screen px"));
  },
});
