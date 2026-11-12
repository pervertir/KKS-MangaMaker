import { H, S, W, layers } from "./state.ts";
import { addSnapSource, axisSource, snapPoint } from "../core/snap.ts";

/* the built-in snap sources every tool shares (core/snap.ts): page edges and centre, then the edges and
   centres of the other layers and the 30 px panel gutter */
let exclude = [];
addSnapSource({ ...axisSource("page", 1, () => ({ xs: [0, W() / 2, W()], ys: [0, H() / 2, H()] })), enabled: () => S.showGuides && !!S.doc });
addSnapSource({ ...axisSource("layers", 2, () => {
  const xs = [], ys = [];
  for (const l of layers()) {
    if (exclude.includes(l.id) || !l.visible || l.rotate) continue;
    xs.push(l.x, l.x + l.w, l.x + l.w / 2); ys.push(l.y, l.y + l.h, l.y + l.h / 2);
    if (l.type === "panel") { const g = 30; xs.push(l.x - g - l.border, l.x + l.w + g + l.border); ys.push(l.y - g - l.border, l.y + l.h + g + l.border); }
  }
  return { xs, ys };
}), enabled: () => S.showGuides && !!S.doc });

/** Snaps a page point for a tool and shows the guide; `from` is the start of a line being drawn. */
export function snapAt(pt, { from, ignore = [] } = {}) {
  exclude = ignore;
  const hit = snapPoint(pt, { threshold: 7 / S.view.s, from, exclude: ignore });
  exclude = [];
  S.guides = hit.guide ? [hit.guide] : [];
  return hit.pt;
}

/* ================================================================ snapping */
export function snapBox(box, moving, thr) {
  const xs = [0, W() / 2, W()], ys = [0, H() / 2, H()];
  for (const l of layers()) {
    if (l.id === moving || !l.visible || l.rotate) continue;
    xs.push(l.x, l.x + l.w, l.x + l.w / 2); ys.push(l.y, l.y + l.h, l.y + l.h / 2);
    if (l.type === "panel") { const g = 30; xs.push(l.x - g - l.border, l.x + l.w + g + l.border); ys.push(l.y - g - l.border, l.y + l.h + g + l.border); }
  }
  const guides = [];
  const best = (cands, targets) => {
    let b = null;
    for (const [v, off] of cands) for (const t of targets) { const d = t - v; if (Math.abs(d) < thr && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, t }; }
    return b;
  };
  const bx = best([[box.x, 0], [box.x + box.w / 2, 0], [box.x + box.w, 0]], xs);
  const by = best([[box.y, 0], [box.y + box.h / 2, 0], [box.y + box.h, 0]], ys);
  if (bx) { box.x += bx.d; guides.push({ x: bx.t }); }
  if (by) { box.y += by.d; guides.push({ y: by.t }); }
  return guides;
}
