import { S, layers } from "./state.ts";
import { corners } from "./view.js";
import { panelHit } from "./frames.js";
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
    if (l.type === "panel") { if (panelHit(l, p.x, p.y)) return l; continue; }
    const def = layerType(l.type);
    if (def) { if (def.hit ? def.hit(l, p.x, p.y) : contains(outlineOf(l), p.x, p.y)) return l; continue; }
    const q = local(l, p);
    if (Math.abs(q.x) <= l.w / 2 && Math.abs(q.y) <= l.h / 2) return l;
  }
  return null;
}
