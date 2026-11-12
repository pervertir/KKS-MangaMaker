import { S, layers } from "./state.ts";
import { HANDLES, corners } from "./view.js";
import { layerType, outlineOf } from "../core/registry.ts";
import { contains } from "../core/geometry/region.ts";

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
    const def = layerType(l.type);
    if (def) { if (def.hit ? def.hit(l, p.x, p.y) : contains(outlineOf(l), p.x, p.y)) return l; continue; }
    const q = local(l, p);
    if (Math.abs(q.x) <= l.w / 2 && Math.abs(q.y) <= l.h / 2) return l;
  }
  return null;
}
export function hitHandle(l, p) {
  if (!l || l.locked || l.type === "ruler") return null;
  const px = 1 / S.view.s, q = local(l, p), hw = l.w / 2, hh = l.h / 2;
  if (l.type === "vbubble" && l.tail && Math.hypot(q.x - l.tail.x, q.y - l.tail.y) < 11 * px) return { tail: true };
  if (l.type !== "panel" && Math.hypot(q.x, q.y + hh + 34 * px) < 9 * px) return { rot: true };
  for (const [hx, hy] of HANDLES) if (Math.abs(q.x - hx * hw) < 8 * px && Math.abs(q.y - hy * hh) < 8 * px) return { hx, hy };
  return null;
}
