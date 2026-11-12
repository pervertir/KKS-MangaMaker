import { FillRule, JoinType, EndType, unionD, differenceD, intersectD, xorD, inflatePathsD, areaD, pointInPolygonD, PointInPolygonResult, simplifyPathsD, type PathsD } from "clipper2-ts";

/** A point in page pixels. */
export type Pt = [number, number];
/** One closed outline, in page pixels. The last point joins back to the first. */
export type Ring = Pt[];
/** An area of the page: closed rings filled even-odd, so a ring inside another is a hole.
 *  Selections, tone and fill regions and panel outlines all use this. */
export type Region = Ring[];

const PREC = 2;
const toD = (r: Region): PathsD => r.map(ring => ring.map(([x, y]) => ({ x, y })));
const fromD = (p: PathsD): Region => p.filter(r => r.length > 2).map(r => r.map(q => [q.x, q.y] as Pt));
const tidy = (r: Region) => fromD(unionD(toD(r), FillRule.EvenOdd));

export const rect = (x: number, y: number, w: number, h: number): Region => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]];
export function ellipse(cx: number, cy: number, rx: number, ry: number, steps = 0): Region {
  const n = steps || Math.max(24, Math.ceil(Math.sqrt(Math.max(rx, ry)) * 6));
  const ring: Ring = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; ring.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return [ring];
}

export const union = (a: Region, b: Region): Region => fromD(unionD(toD(a), toD(b), FillRule.EvenOdd, PREC));
export const subtract = (a: Region, b: Region): Region => fromD(differenceD(toD(a), toD(b), FillRule.EvenOdd, PREC));
export const intersect = (a: Region, b: Region): Region => fromD(intersectD(toD(a), toD(b), FillRule.EvenOdd, PREC));
export const exclude = (a: Region, b: Region): Region => fromD(xorD(toD(a), toD(b), FillRule.EvenOdd, PREC));
export type CombineMode = "replace" | "add" | "subtract" | "intersect";
export function combine(base: Region | null, next: Region, mode: CombineMode): Region {
  if (!base?.length || mode === "replace") return tidy(next);
  return mode === "add" ? union(base, next) : mode === "subtract" ? subtract(base, next) : intersect(base, next);
}

/** Grows (d > 0) or shrinks (d < 0) a region by d page px. */
export function offset(r: Region, d: number, join: "round" | "miter" | "square" = "round"): Region {
  if (!d) return r;
  const jt = join === "miter" ? JoinType.Miter : join === "square" ? JoinType.Square : JoinType.Round;
  return fromD(inflatePathsD(toD(tidy(r)), d, jt, EndType.Polygon, 4, PREC));
}
/** Thickens an open polyline into a region (a stroke of width w). */
export function strokeLine(line: Pt[], w: number, round = true): Region {
  return fromD(inflatePathsD([line.map(([x, y]) => ({ x, y }))], w / 2, round ? JoinType.Round : JoinType.Miter, round ? EndType.Round : EndType.Butt, 4, PREC));
}
export const simplify = (r: Region, eps = 0.5): Region => fromD(simplifyPathsD(toD(r), eps, true));

export const area = (r: Region): number => Math.abs(tidy(r).reduce((s, ring) => s + areaD(ring.map(([x, y]) => ({ x, y }))), 0));
export function contains(r: Region, x: number, y: number): boolean {
  let inside = false;
  for (const ring of r) if (pointInPolygonD({ x, y }, ring.map(([a, b]) => ({ x: a, y: b }))) !== PointInPolygonResult.IsOutside) inside = !inside;
  return inside;
}
export function bounds(r: Region): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of r) for (const [x, y] of ring) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const isEmpty = (r: Region | null | undefined): boolean => !r || !r.some(ring => ring.length > 2);
export const translate = (r: Region, dx: number, dy: number): Region => r.map(ring => ring.map(([x, y]) => [x + dx, y + dy] as Pt));
export const transform = (r: Region, m: [number, number, number, number, number, number]): Region =>
  r.map(ring => ring.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as Pt));

/** Adds the region to the context's current path; fill or clip it with "evenodd". */
export function trace(ctx: CanvasRenderingContext2D | Path2D, r: Region): void {
  for (const ring of r) {
    if (ring.length < 3) continue;
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
    ctx.closePath();
  }
}
export function toPath2D(r: Region): Path2D { const p = new Path2D(); trace(p, r); return p; }
export function clipTo(ctx: CanvasRenderingContext2D, r: Region): void { ctx.beginPath(); trace(ctx, r); ctx.clip("evenodd"); }
export const toSvg = (r: Region): string =>
  r.filter(g => g.length > 2).map(g => "M" + g.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join("L") + "Z").join("");
