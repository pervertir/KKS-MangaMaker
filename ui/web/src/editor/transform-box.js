import { deep } from "./core.js";
import { H, S, W, layers } from "./state.ts";
import { layerType } from "../core/registry.ts";
import { frame, handles, hitHandle, rotateTo, scaleBox } from "../core/transform.ts";
import { isPlainRect, tracePanel } from "./frames.js";
import { boxPad, drawVertices, hitVertex } from "./polygon-panels.js";
import { drawHandles, scaleShapes } from "../lettering/handles.ts";

/* ================================================================ transform box */
/* One move / scale / rotate box for every layer type. Built-in types set their rules here; registered types
   through defineLayerType({transform}). */
const scaleTail = (l, l0) => { if (l0.tail) l.tail = { x: l0.tail.x * l.w / l0.w, y: l0.tail.y * l.h / l0.h }; };
const BUILTIN = {
  panel: { rotate: false },
  bubble: { aspect: true },
  image: { aspect: true },
  vbubble: { onScale: scaleTail },
};
export function rulesFor(l) {
  const def = layerType(l.type);
  if (def && "transform" in def) return def.transform === false ? null : (def.transform || {});
  return BUILTIN[l.type] || {};
}
/* a polygon panel's box stands a little outside its corner handles */
const padded = (l, k) => k ? { ...l, x: l.x - k, y: l.y - k, w: l.w + 2 * k, h: l.h + 2 * k } : l;
/* what is under p on the selected layer's box: a scale or rotate handle, or the drawn bubble's tail */
export function boxHit(l, p) {
  if (!l || l.locked) return null;
  const R = rulesFor(l); if (!R) return null;
  const px = 1 / S.view.s;
  if (l.type === "vbubble" && l.tail) {
    const q = frame(l).toLocal([p.x, p.y]);
    if (Math.hypot(q[0] - l.tail.x, q[1] - l.tail.y) < 11 * px) return { kind: "tail" };
  }
  return hitVertex(l, p, px) || hitHandle(padded(l, boxPad(l, px)), [p.x, p.y], px, R);
}
export function beginTransform(l, h, p) { return { layer: l, l0: deep(l), p0: p, handle: h, pad: boxPad(l, 1 / S.view.s) }; }
/* Shift flips the type's aspect rule, Alt scales about the centre; panels snap their moving edges */
export function applyScale(l, d, p, e) {
  const R = rulesFor(l) || {}, h = d.handle;
  const k = d.pad || 0, b = scaleBox(padded(d.l0, k), h, [p.x, p.y], { keepAspect: !!R.aspect !== !!e.shiftKey, fromCentre: e.altKey, min: R.min });
  l.x = b.x + k; l.y = b.y + k; l.w = Math.max(1, b.w - 2 * k); l.h = Math.max(1, b.h - 2 * k);
  R.onScale?.(l, d.l0);
  scaleShapes(l, d.l0, l.w / d.l0.w, l.h / d.l0.h);
  if (l.type === "panel" && S.showGuides && !l.rotate && !e.altKey) snapPanelEdges(l, h);
}
export function applyRotate(l, d, p, shift) { l.rotate = rotateTo(d.l0, [p.x, p.y], shift ? 15 : 0); }
function snapPanelEdges(l, h) {
  S.guides = [];
  const thr = 7 / S.view.s, snapV = (v, ts) => { for (const t of ts) if (Math.abs(t - v) < thr) return t; return null; };
  const others = layers().filter(o => o.id !== l.id && o.type === "panel");
  const xs = [0, W(), ...others.flatMap(o => [o.x, o.x + o.w, o.x - 30 - o.border, o.x + o.w + 30 + o.border])];
  const ys = [0, H(), ...others.flatMap(o => [o.y, o.y + o.h, o.y - 30 - o.border, o.y + o.h + 30 + o.border])];
  if (h.hx === 1) { const t = snapV(l.x + l.w, xs); if (t != null) { l.w = t - l.x; S.guides.push({ x: t }); } }
  if (h.hx === -1) { const t = snapV(l.x, xs); if (t != null) { l.w += l.x - t; l.x = t; S.guides.push({ x: t }); } }
  if (h.hy === 1) { const t = snapV(l.y + l.h, ys); if (t != null) { l.h = t - l.y; S.guides.push({ y: t }); } }
  if (h.hy === -1) { const t = snapV(l.y, ys); if (t != null) { l.h += l.y - t; l.y = t; S.guides.push({ y: t }); } }
}
export function drawTransformBox(ctx, l, px) {
  const R = rulesFor(l), b = padded(l, boxPad(l, px)), f = frame(b), hw = b.w / 2, hh = b.h / 2;
  const pts = [f.P(-hw, -hh), f.P(hw, -hh), f.P(hw, hh), f.P(-hw, hh)];
  ctx.save();
  ctx.strokeStyle = l.locked ? "#f5b84b" : "#4c8dff"; ctx.lineWidth = 1.5 * px;
  if (l.type === "panel" && !isPlainRect(l)) { ctx.beginPath(); tracePanel(ctx, l); ctx.stroke(); ctx.setLineDash([6 * px, 5 * px]); }
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  if (!l.locked && R) {
    drawVertices(ctx, l, px);
    const lf = frame(l);
    drawHandles(ctx, l, (x, y) => { const q = lf.P(x, y); return { x: q[0], y: q[1] }; }, px);
    for (const { handle, pt } of handles(b, px, R)) {
      if (handle.kind === "rotate") {
        const t = f.P(0, -hh);
        ctx.beginPath(); ctx.moveTo(t[0], t[1]); ctx.lineTo(pt[0], pt[1]); ctx.stroke();
        ctx.fillStyle = "#4c8dff"; ctx.beginPath(); ctx.arc(pt[0], pt[1], 6 * px, 0, 7); ctx.fill();
      } else {
        const r = 5 * px;
        ctx.fillStyle = "#fff"; ctx.fillRect(pt[0] - r, pt[1] - r, r * 2, r * 2); ctx.strokeRect(pt[0] - r, pt[1] - r, r * 2, r * 2);
      }
    }
    if (l.type === "vbubble" && l.tail) {
      const t = f.P(l.tail.x, l.tail.y);
      ctx.fillStyle = "#ff4f7b"; ctx.beginPath(); ctx.arc(t[0], t[1], 7 * px, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.stroke();
    }
  }
  ctx.restore();
}
