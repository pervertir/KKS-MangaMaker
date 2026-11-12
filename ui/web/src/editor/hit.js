import { S, layers } from "./state.js";
import { HANDLES, corners, boxPad, isPolyPanel, vertexHandles } from "./view.js";
import { panelHit } from "./frames.js";

/* ================================================================ hit testing */
export function local(l, p) {
  const { cx, cy, a } = corners(l), dx = p.x - cx, dy = p.y - cy, c = Math.cos(-a), s = Math.sin(-a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
export function hitLayer(p, pred = () => true) {
  const ls = layers();
  for (let i = ls.length - 1; i >= 0; i--) {
    const l = ls[i];
    if (!l.visible || !pred(l)) continue;
    if (l.type === "panel") { if (panelHit(l, p.x, p.y)) return l; continue; }
    const q = local(l, p);
    if (Math.abs(q.x) <= l.w / 2 && Math.abs(q.y) <= l.h / 2) return l;
  }
  return null;
}
export function hitHandle(l, p) {
  if (!l || l.locked) return null;
  const px = 1 / S.view.s, q = local(l, p), pad = boxPad(l, px), hw = l.w / 2 + pad, hh = l.h / 2 + pad;
  if (isPolyPanel(l)) {
    const { P: V, M } = vertexHandles(l);
    for (let i = 0; i < V.length; i++) if (Math.hypot(p.x - V[i].x, p.y - V[i].y) < 10 * px) return { vert: i };
    for (let i = 0; i < M.length; i++) if (Math.hypot(p.x - M[i].x, p.y - M[i].y) < 8 * px) return { mid: i };
  }
  if (l.type === "vbubble" && l.tail && Math.hypot(q.x - l.tail.x, q.y - l.tail.y) < 11 * px) return { tail: true };
  if (l.type !== "panel" && Math.hypot(q.x, q.y + hh + 34 * px) < 9 * px) return { rot: true };
  for (const [hx, hy] of HANDLES) if (Math.abs(q.x - hx * hw) < 8 * px && Math.abs(q.y - hy * hh) < 8 * px) return { hx, hy };
  return null;
}
