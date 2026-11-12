import type { Pt } from "./geometry/region.ts";

export type Guide = { x: number } | { y: number } | { line: [Pt, Pt] } | { point: Pt };
export interface SnapHit { pt: Pt; guide?: Guide; source: string }
export interface SnapQuery {
  /** snapping distance in page px (usually a few screen px) */
  threshold: number;
  /** where a line being drawn starts, for sources that snap direction (rulers, angle steps) */
  from?: Pt;
  /** layer ids to ignore (the ones being moved) */
  exclude?: string[];
}
/** Something points can snap to: perspective rulers, guides, panel edges, layer boxes, a grid. Higher priority wins
 *  over a closer hit from a lower one. */
export interface SnapSource { id: string; priority: number; enabled?(): boolean; snap(pt: Pt, q: SnapQuery): SnapHit | null }

const sources = new Map<string, SnapSource>();
let on = true;
export function addSnapSource(s: SnapSource): () => void { sources.set(s.id, s); return () => { if (sources.get(s.id) === s) sources.delete(s.id); }; }
export const snapSources = (): SnapSource[] => [...sources.values()].sort((a, b) => b.priority - a.priority);
export function setSnapping(v: boolean): void { on = v; }
export const snappingOn = (): boolean => on;

/** The snapped point (or the point itself) and the guide to draw. Pens, the knife, the node editor and moves all ask here. */
export function snapPoint(pt: Pt, q: SnapQuery): SnapHit {
  if (!on) return { pt, source: "" };
  let best: SnapHit | null = null, bestP = -Infinity, bestD = Infinity;
  for (const s of snapSources()) {
    if (s.enabled && !s.enabled()) continue;
    const h = s.snap(pt, q);
    if (!h) continue;
    const d = Math.hypot(h.pt[0] - pt[0], h.pt[1] - pt[1]);
    if (d > q.threshold * 1.0001 && !(q.from && h.guide && "line" in h.guide)) continue;
    if (s.priority > bestP || (s.priority === bestP && d < bestD)) { best = h; bestP = s.priority; bestD = d; }
  }
  return best ?? { pt, source: "" };
}

/** Snap source for fixed x and y lines (page edges, centres, layer edges): each axis snaps on its own. */
export function axisSource(id: string, priority: number, lines: () => { xs: number[]; ys: number[] }): SnapSource {
  return {
    id, priority,
    snap(pt, q) {
      const { xs, ys } = lines();
      let bx: number | null = null, by: number | null = null;
      for (const x of xs) if (Math.abs(x - pt[0]) <= q.threshold && (bx === null || Math.abs(x - pt[0]) < Math.abs(bx - pt[0]))) bx = x;
      for (const y of ys) if (Math.abs(y - pt[1]) <= q.threshold && (by === null || Math.abs(y - pt[1]) < Math.abs(by - pt[1]))) by = y;
      if (bx === null && by === null) return null;
      const p: Pt = [bx ?? pt[0], by ?? pt[1]];
      return { pt: p, source: id, guide: bx !== null && by !== null ? { point: p } : bx !== null ? { x: bx } : { y: by! } };
    },
  };
}
/** Snaps the direction from q.from to angle steps (Shift-style 15° lines). */
export function angleSource(id: string, priority: number, stepDeg: number, enabled: () => boolean): SnapSource {
  return {
    id, priority, enabled,
    snap(pt, q) {
      if (!q.from) return null;
      const dx = pt[0] - q.from[0], dy = pt[1] - q.from[1], L = Math.hypot(dx, dy);
      if (!L) return null;
      const a = Math.round(Math.atan2(dy, dx) / (stepDeg * Math.PI / 180)) * stepDeg * Math.PI / 180;
      const p: Pt = [q.from[0] + Math.cos(a) * L, q.from[1] + Math.sin(a) * L];
      return { pt: p, source: id, guide: { line: [q.from, p] } };
    },
  };
}
