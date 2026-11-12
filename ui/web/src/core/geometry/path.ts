import { Bezier } from "bezier-js";
import type { Pt, Region, Ring } from "./region.ts";

/** One stretch of a subpath: a straight line or a cubic bezier to `p`. */
export type Seg = { p: Pt; c1?: Pt; c2?: Pt };
/** A subpath starts at `start` and runs through its segments; closed ones join back to `start`. */
export interface SubPath { start: Pt; segs: Seg[]; closed: boolean }
/** Editable vector outline: balloons, panel edges, SFX baselines, selection outlines, strokes. */
export interface Path { subs: SubPath[] }

export const line = (pts: Pt[], closed = false): Path =>
  ({ subs: pts.length ? [{ start: pts[0], segs: pts.slice(1).map(p => ({ p })), closed }] : [] });
export const fromRegion = (r: Region): Path => ({ subs: r.map(ring => ({ start: ring[0], segs: ring.slice(1).map(p => ({ p })), closed: true })) });

const bez = (a: Pt, s: Seg) => new Bezier(a[0], a[1], s.c1![0], s.c1![1], s.c2![0], s.c2![1], s.p[0], s.p[1]);
function segsOf(sp: SubPath): Seg[] { return sp.closed && sp.segs.length && !same(sp.segs[sp.segs.length - 1].p, sp.start) ? [...sp.segs, { p: sp.start }] : sp.segs; }
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Polylines through the path, curves cut so no point strays more than `tol` px from the curve. */
export function flatten(path: Path, tol = 0.25): { pts: Pt[]; closed: boolean }[] {
  return path.subs.map(sp => {
    const pts: Pt[] = [sp.start];
    let a = sp.start;
    for (const s of segsOf(sp)) {
      if (s.c1 && s.c2) {
        const len = bez(a, s).length(), n = Math.max(2, Math.ceil(Math.sqrt(len / (8 * tol)) * 2));
        const b = bez(a, s);
        for (let i = 1; i <= n; i++) { const q = b.get(i / n); pts.push([q.x, q.y]); }
      } else pts.push(s.p);
      a = s.p;
    }
    if (sp.closed && pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
    return { pts, closed: sp.closed };
  });
}
/** The area inside the closed subpaths. */
export const toRegion = (path: Path, tol = 0.25): Region => flatten(path, tol).filter(f => f.closed && f.pts.length > 2).map(f => f.pts as Ring);

export function trace(ctx: CanvasRenderingContext2D | Path2D, path: Path): void {
  for (const sp of path.subs) {
    ctx.moveTo(sp.start[0], sp.start[1]);
    for (const s of sp.segs) s.c1 && s.c2 ? ctx.bezierCurveTo(s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.p[0], s.p[1]) : ctx.lineTo(s.p[0], s.p[1]);
    if (sp.closed) ctx.closePath();
  }
}
export function toPath2D(path: Path): Path2D { const p = new Path2D(); trace(p, path); return p; }
export function toSvg(path: Path): string {
  const f = (p: Pt) => `${+p[0].toFixed(2)} ${+p[1].toFixed(2)}`;
  return path.subs.map(sp => "M" + f(sp.start) + sp.segs.map(s => s.c1 && s.c2 ? `C${f(s.c1)} ${f(s.c2)} ${f(s.p)}` : `L${f(s.p)}`).join("") + (sp.closed ? "Z" : "")).join("");
}
export function length(path: Path): number {
  let L = 0;
  for (const sp of path.subs) { let a = sp.start; for (const s of segsOf(sp)) { L += s.c1 && s.c2 ? bez(a, s).length() : Math.hypot(s.p[0] - a[0], s.p[1] - a[1]); a = s.p; } }
  return L;
}
/** Point and unit tangent at distance d along the first subpath (SFX and text on a path). */
export function pointAt(path: Path, d: number): { p: Pt; t: Pt } | null {
  const sp = path.subs[0]; if (!sp) return null;
  let a = sp.start, last: { p: Pt; t: Pt } | null = null;
  for (const s of segsOf(sp)) {
    if (s.c1 && s.c2) {
      const b = bez(a, s), L = b.length();
      if (d <= L) { const t = L ? d / L : 0, q = b.get(t), dv = b.derivative(t), n = Math.hypot(dv.x, dv.y) || 1; return { p: [q.x, q.y], t: [dv.x / n, dv.y / n] }; }
      d -= L; const dv = b.derivative(1), n = Math.hypot(dv.x, dv.y) || 1; last = { p: s.p, t: [dv.x / n, dv.y / n] };
    } else {
      const dx = s.p[0] - a[0], dy = s.p[1] - a[1], L = Math.hypot(dx, dy), n = L || 1;
      if (d <= L) return { p: [a[0] + dx * d / n, a[1] + dy * d / n], t: [dx / n, dy / n] };
      d -= L; last = { p: s.p, t: [dx / n, dy / n] };
    }
    a = s.p;
  }
  return last;
}
/** Nearest point on the path to (x, y): which subpath and segment, the curve parameter and the distance. */
export function nearest(path: Path, x: number, y: number): { sub: number; seg: number; t: number; p: Pt; d: number } | null {
  let best: { sub: number; seg: number; t: number; p: Pt; d: number } | null = null;
  path.subs.forEach((sp, si) => {
    let a = sp.start;
    segsOf(sp).forEach((s, gi) => {
      let p: Pt, t: number;
      if (s.c1 && s.c2) { const q = bez(a, s).project({ x, y }); p = [q.x, q.y]; t = q.t ?? 0; }
      else {
        const dx = s.p[0] - a[0], dy = s.p[1] - a[1], L2 = dx * dx + dy * dy;
        t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0; p = [a[0] + dx * t, a[1] + dy * t];
      }
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (!best || d < best.d) best = { sub: si, seg: gi, t, p, d };
      a = s.p;
    });
  });
  return best;
}
/** Splits segment `seg` of subpath `sub` at parameter t, adding an anchor there (the node editor's "add point"). */
export function splitAt(path: Path, sub: number, seg: number, t: number): Path {
  const sp = path.subs[sub], segs = segsOf(sp), s = segs[seg];
  const a = seg === 0 ? sp.start : segs[seg - 1].p;
  let parts: Seg[];
  if (s.c1 && s.c2) {
    const { left, right } = bez(a, s).split(t), L = left.points, R = right.points;
    parts = [{ c1: [L[1].x, L[1].y], c2: [L[2].x, L[2].y], p: [L[3].x, L[3].y] }, { c1: [R[1].x, R[1].y], c2: [R[2].x, R[2].y], p: s.p }];
  } else parts = [{ p: [a[0] + (s.p[0] - a[0]) * t, a[1] + (s.p[1] - a[1]) * t] }, { p: s.p }];
  const next = [...segs]; next.splice(seg, 1, ...parts);
  if (sp.closed && segs !== sp.segs) next.pop();
  return { subs: path.subs.map((q, i) => i === sub ? { ...q, segs: next } : q) };
}
/** Smooth path through freehand points (Catmull-Rom to cubic beziers), for lasso and pen fitting. */
export function smoothThrough(pts: Pt[], closed = false, tension = 0.5): Path {
  if (pts.length < 3) return line(pts, closed);
  const n = pts.length, P = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const segs: Seg[] = [], k = tension / 3, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    segs.push({ c1: [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k], c2: [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k], p: p2 });
  }
  return { subs: [{ start: pts[0], segs, closed }] };
}
export const clone = (p: Path): Path => JSON.parse(JSON.stringify(p));
