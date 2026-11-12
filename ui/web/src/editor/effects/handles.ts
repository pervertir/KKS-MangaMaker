/* On-canvas editing of effects: gradient start/end, the focus centre, the size or outline of the
   "no line" shape, and the tone eraser. Handles sit on the selected layer and are dragged with the
   Move tool; the eraser is its own tool. */
import { S } from "../state.ts";
import { clamp, fromFrac, toFrac, type Pt } from "./geom.ts";
import { innerPolygon, type SpeedSpec } from "./speed.ts";
import type { EraseStroke } from "./render.ts";

type L = Record<string, any>;
export interface FxHandle { kind: "gradA" | "gradB" | "center" | "inner" | "pt"; i?: number; at: Pt }

export const fxLayer = (l: L | null): boolean => !!l && (l.type === "tone" || l.type === "speed");

export function fxHandles(l: L | null): FxHandle[] {
  if (!l || l.locked || !fxLayer(l)) return [];
  const out: FxHandle[] = [];
  if (l.type === "tone" && l.grad) {
    out.push({ kind: "gradA", at: fromFrac(l as any, l.grad.a) }, { kind: "gradB", at: fromFrac(l as any, l.grad.b) });
  }
  if (l.type === "speed" && l.mode !== "parallel") {
    const c = l.center || [0.5, 0.5];
    out.push({ kind: "center", at: fromFrac(l as any, c) });
    if (l.innerPts?.length > 2) l.innerPts.forEach((q: Pt, i: number) => out.push({ kind: "pt", i, at: fromFrac(l as any, q) }));
    else out.push({ kind: "inner", at: fromFrac(l as any, [c[0] + l.inner / 2, c[1]]) });
  }
  return out;
}
export function fxHit(l: L | null, p: { x: number; y: number }): FxHandle | null {
  const r = 9 / S.view.s;
  for (const hd of fxHandles(l).reverse()) if (Math.hypot(hd.at[0] - p.x, hd.at[1] - p.y) < r) return hd;
  return null;
}
export function fxDrag(l: L, hd: FxHandle, p: { x: number; y: number }, l0: L, shift: boolean) {
  const f = toFrac(l as any, [p.x, p.y]), F = (v: Pt): Pt => [+clamp(v[0], -1, 2).toFixed(4), +clamp(v[1], -1, 2).toFixed(4)];
  if (hd.kind === "gradA" || hd.kind === "gradB") {
    let v = f;
    const other: Pt = hd.kind === "gradA" ? l.grad.b : l.grad.a;
    if (shift) {                                              // snap the gradient to 45° steps
      const dx = (v[0] - other[0]) * l.w, dy = (v[1] - other[1]) * l.h, a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(dx, dy);
      v = [other[0] + Math.cos(a) * d / l.w, other[1] + Math.sin(a) * d / l.h];
    }
    l.grad = { ...l.grad, [hd.kind === "gradA" ? "a" : "b"]: F(v) };
  } else if (hd.kind === "center") {
    const c = F(f), d0 = [c[0] - l0.center[0], c[1] - l0.center[1]];
    l.center = c;
    if (l0.innerPts?.length) l.innerPts = l0.innerPts.map(([x, y]: Pt) => F([x + d0[0], y + d0[1]]));
  } else if (hd.kind === "inner") {
    const c = l.center || [0.5, 0.5];
    l.inner = +clamp(Math.hypot((f[0] - c[0]) * l.w, (f[1] - c[1]) * l.h) * 2 / l.w, 0, 1.5).toFixed(3);
  } else if (hd.kind === "pt" && hd.i != null) {
    const pts = [...l.innerPts]; pts[hd.i] = F(f); l.innerPts = pts;
  }
}
export function makeInnerEditable(l: L) {
  if (l.type !== "speed") return;
  l.innerPts = innerPolygon(l as unknown as SpeedSpec).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
}

export function drawFxHandles(ctx: CanvasRenderingContext2D, l: L | null, px: number) {
  const hs = fxHandles(l); if (!hs.length || !l) return;
  ctx.save(); ctx.lineWidth = 1.5 * px;
  const a = hs.find(q => q.kind === "gradA"), b = hs.find(q => q.kind === "gradB");
  if (a && b) {
    ctx.setLineDash([5 * px, 4 * px]); ctx.strokeStyle = "#ffb020";
    ctx.beginPath(); ctx.moveTo(...a.at); ctx.lineTo(...b.at); ctx.stroke();
    if (l.grad.kind === "radial") { ctx.beginPath(); ctx.arc(a.at[0], a.at[1], Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]), 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const pts = hs.filter(q => q.kind === "pt");
  if (pts.length) {
    ctx.strokeStyle = "#ffb020"; ctx.setLineDash([4 * px, 3 * px]);
    ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(...q.at) : ctx.moveTo(...q.at)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  } else if (l.type === "speed" && l.mode !== "parallel") {
    const c = fromFrac(l as any, l.center || [0.5, 0.5]);
    ctx.strokeStyle = "#ffb020"; ctx.setLineDash([4 * px, 3 * px]);
    ctx.beginPath(); ctx.ellipse(c[0], c[1], l.inner * l.w / 2, l.inner * l.h / 2, (l.rotate || 0) * Math.PI / 180, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const hd of hs) {
    const r = (hd.kind === "pt" ? 4.5 : 6.5) * px;
    ctx.fillStyle = hd.kind === "gradA" ? "#fff" : hd.kind === "gradB" ? "#111" : hd.kind === "center" ? "#ff4f7b" : "#ffb020";
    ctx.strokeStyle = hd.kind === "gradB" ? "#fff" : "#111";
    ctx.beginPath();
    if (hd.kind === "center") { ctx.moveTo(hd.at[0] - r, hd.at[1]); ctx.lineTo(hd.at[0], hd.at[1] - r); ctx.lineTo(hd.at[0] + r, hd.at[1]); ctx.lineTo(hd.at[0], hd.at[1] + r); ctx.closePath(); }
    else ctx.arc(hd.at[0], hd.at[1], r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/* -------- eraser: strokes stored in box fractions, radius in page px */
export const eraser = { r: 24 };
export function eraseStart(l: L, p: { x: number; y: number }) {
  const st: EraseStroke = { r: eraser.r, pts: [toFrac(l as any, [p.x, p.y])] };
  l.erase = [...(l.erase || []), st];
  return st;
}
export function eraseMove(l: L, p: { x: number; y: number }) {
  const er = l.erase as EraseStroke[], st = er[er.length - 1], f = toFrac(l as any, [p.x, p.y]), last = st.pts[st.pts.length - 1];
  if (Math.hypot((f[0] - last[0]) * l.w, (f[1] - last[1]) * l.h) * S.view.s < 2) return false;
  l.erase = [...er.slice(0, -1), { ...st, pts: [...st.pts, [+f[0].toFixed(5), +f[1].toFixed(5)] as Pt] }];
  return true;
}
