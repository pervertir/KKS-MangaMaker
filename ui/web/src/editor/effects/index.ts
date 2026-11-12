/* Screentone and speed-line layers and the tone eraser, registered with the editor core. */
import { defineLayerType } from "../../core/registry.ts";
import { registerTool } from "../../core/tools.ts";
import { onSelection } from "../../core/selection.ts";
import { renderOptions } from "../options.js";
import { S, selL } from "../state.ts";
import { commit } from "../history.js";
import { status } from "../misc.js";
import { requestDraw } from "../view.js";
import { h } from "../core.js";
import { drawEffect } from "./render.ts";
import { migrateTone, pageDpi } from "./tones.ts";
import { migrateSpeed } from "./speed.ts";
import { eraseMove, eraseStart, eraser, fxLayer } from "./handles.ts";

defineLayerType({
  type: "tone", label: "Screentone",
  defaults(l: any) {
    migrateTone(l, pageDpi(S.doc));
    l.shape ||= "round"; l.lpi ??= 60; l.pct ??= 30; l.angle ??= 45; l.grad ??= null; l.color ||= "#000000"; l.seed ??= 1;
    l.region ??= null; l.erase ??= [];
  },
  draw: (ctx, l, opt) => drawEffect(ctx, l, opt.rs || 1),
});
defineLayerType({
  type: "speed", label: "Speed lines",
  defaults(l: any) { migrateSpeed(l); l.color ||= "#000000"; l.seed ??= 1; l.region ??= null; l.erase ??= []; },
  draw: (ctx, l, opt) => drawEffect(ctx, l, opt.rs || 1),
});

let hover: { x: number; y: number } | null = null, target: any = null;
registerTool({
  id: "erase", label: "Tone eraser: rub out part of the selected screentone or lines", key: "e", group: "effects", cursor: "none",
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 4.5l5 5-9 9H6l-2.5-2.5z"/><path d="M9.5 9.5l5 5M10.5 18.5H20"/></svg>',
  down(e) {
    const l = selL();
    if (!fxLayer(l) || l!.locked) { status("Select a screentone or speed lines layer to erase from"); target = null; return; }
    target = l; eraseStart(l!, e.raw); requestDraw();
  },
  move(e) {
    hover = e.raw;
    if (!target) return;
    let changed = false;
    for (const s of e.samples) changed = eraseMove(target, s) || changed;
    if (changed) requestDraw();
  },
  up() { if (target) { commit("Erased"); target = null; } },
  hover(e) { hover = e.raw; },
  cancel() { target = null; },
  overlay(ctx, px) {
    if (!hover) return;
    ctx.save(); ctx.lineWidth = px; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(hover.x, hover.y, eraser.r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "#000"; ctx.setLineDash([3 * px, 3 * px]); ctx.stroke(); ctx.restore();
  },
  options(bar) {
    const v = h("span", { class: "val" }, String(eraser.r));
    bar.append(h("label", { class: "inl", title: "Eraser radius in page px" }, "Size",
      h("input", { type: "range", min: 2, max: 200, value: eraser.r, style: "width:110px", oninput: (ev: Event) => { eraser.r = +(ev.target as HTMLInputElement).value; v.textContent = String(eraser.r); } }), v));
    if (!fxLayer(selL())) bar.append(h("span", { class: "hint" }, "Select a screentone or speed lines layer first"));
  },
});

/* the options bar offers "Fill selection" once there is one */
onSelection(() => { if (S.tool === "tone" || S.tool === "speed") renderOptions(); });
