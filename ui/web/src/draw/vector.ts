import { getStroke } from "perfect-freehand";
import type { Layer } from "../types.ts";

/* A line-art layer is a list of items in the layer's own pixels:
   strokes keep the raw pen samples ("x y p" triplets in one string, so project.json stays compact)
   and their outline is worked out again only when the stroke changes; fills keep an SVG path. */
export interface StrokeItem {
  k: "s"; pts: string; color: string; size: number;
  thinning: number; smoothing: number; streamline: number; taper: [number, number];
  /** false for mouse input: perfect-freehand then makes up pressure from speed */
  pen: boolean;
}
export interface FillItem { k: "f"; d: string; color: string }
export type Item = StrokeItem | FillItem;
export type Pt = [number, number, number];

const PTS = new Map<string, Pt[]>();
export function decode(s: string): Pt[] {
  let v = PTS.get(s);
  if (v) return v;
  const n = s ? s.split(" ").map(Number) : [];
  v = [];
  for (let i = 0; i + 2 < n.length; i += 3) v.push([n[i], n[i + 1], n[i + 2]]);
  if (PTS.size > 3000) PTS.clear();
  PTS.set(s, v);
  return v;
}
export const encode = (ps: Pt[]): string => ps.map(([x, y, p]) => `${+x.toFixed(1)} ${+y.toFixed(1)} ${+p.toFixed(2)}`).join(" ");

const taperOf = (t: number) => (t >= 9999 ? true : t);
export function outline(st: Omit<StrokeItem, "k" | "pts" | "color">, ps: Pt[], last = true): Path2D {
  const o = getStroke(ps, {
    size: st.size, thinning: st.thinning, smoothing: st.smoothing, streamline: st.streamline,
    simulatePressure: !st.pen, last,
    start: { taper: taperOf(st.taper[0]), cap: true }, end: { taper: taperOf(st.taper[1]), cap: true },
  });
  const p = new Path2D();
  if (o.length < 2) return p;
  p.moveTo(o[0][0], o[0][1]);
  for (let i = 1; i < o.length - 1; i++) {
    const [x0, y0] = o[i], [x1, y1] = o[i + 1];
    p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  p.closePath();
  return p;
}
const PATHS = new WeakMap<Item, { key: string; path: Path2D }>();
export function pathOf(it: Item): Path2D {
  const key = it.k === "f" ? it.d : `${it.pts}|${it.size}|${it.thinning}|${it.smoothing}|${it.streamline}|${it.taper}|${it.pen}`;
  const c = PATHS.get(it);
  if (c && c.key === key) return c.path;
  const path = it.k === "f" ? new Path2D(it.d) : outline(it, decode(it.pts));
  PATHS.set(it, { key, path });
  return path;
}
export function drawItems(ctx: CanvasRenderingContext2D, l: Layer) {
  for (const it of (l.items || []) as Item[]) {
    ctx.fillStyle = it.color;
    ctx.fill(pathOf(it), it.k === "f" ? "evenodd" : "nonzero");
  }
}

let probe: CanvasRenderingContext2D | null = null;
const probeCtx = () => (probe ||= document.createElement("canvas").getContext("2d")!);
/** index of the topmost item under (x, y), with `pad` layer px of slack */
export function itemAt(l: Layer, x: number, y: number, pad = 0): number {
  const g = probeCtx(), its = (l.items || []) as Item[];
  g.lineWidth = pad * 2;
  for (let i = its.length - 1; i >= 0; i--) {
    const p = pathOf(its[i]);
    if (g.isPointInPath(p, x, y, its[i].k === "f" ? "evenodd" : "nonzero") || (pad > 0 && g.isPointInStroke(p, x, y))) return i;
  }
  return -1;
}

/* ---------------------------------------------------------------- vector eraser */
function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}
function touches(st: StrokeItem, x: number, y: number, r: number): boolean {
  const ps = decode(st.pts), reach = r + st.size / 2;
  if (ps.length === 1) return Math.hypot(ps[0][0] - x, ps[0][1] - y) <= reach;
  for (let i = 1; i < ps.length; i++) if (segDist(x, y, ps[i - 1], ps[i]) <= reach) return true;
  return false;
}
/* points no further apart than `step`, so a cut lands where the eraser was */
function resample(ps: Pt[], step: number): Pt[] {
  const out: Pt[] = [ps[0]];
  for (let i = 1; i < ps.length; i++) {
    const a = ps[i - 1], b = ps[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 1; k <= n; k++) { const f = k / n; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); }
  }
  return out;
}
const piece = (st: StrokeItem, ps: Pt[], head: boolean, tail: boolean): StrokeItem =>
  ({ ...st, pts: encode(ps), taper: [head ? st.taper[0] : 0, tail ? st.taper[1] : 0] });

/** where segment ab crosses cd, as the fraction along ab */
function cross(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
function at(ps: Pt[], t: number): Pt {
  const i = Math.min(ps.length - 2, Math.floor(t)), f = t - i, a = ps[i], b = ps[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
function slice(ps: Pt[], t0: number, t1: number): Pt[] {
  const out: Pt[] = [at(ps, t0)];
  for (let i = Math.ceil(t0); i <= Math.floor(t1); i++) if (i > t0 && i < t1) out.push(ps[i]);
  out.push(at(ps, t1));
  return out;
}
/** Removes what the eraser at (x, y) with radius r touches. Returns true when something changed. */
export function eraseAt(l: Layer, x: number, y: number, r: number, mode: "stroke" | "intersect" | "partial"): boolean {
  const its = (l.items || []) as Item[], out: Item[] = [];
  let changed = false;
  for (const it of its) {
    if (it.k === "f") {
      if (probeCtx().isPointInPath(pathOf(it), x, y, "evenodd")) { changed = true; continue; }
      out.push(it); continue;
    }
    if (!touches(it, x, y, r)) { out.push(it); continue; }
    changed = true;
    if (mode === "stroke") continue;
    const ps = decode(it.pts);
    if (ps.length < 2) continue;
    if (mode === "partial") {
      const rs = resample(ps, Math.max(0.5, r / 3)), reach = r + it.size / 2;
      let run: Pt[] = [], head = true;
      for (const q of rs) {
        if (Math.hypot(q[0] - x, q[1] - y) > reach) run.push(q);
        else { if (run.length > 1) out.push(piece(it, run, head, false)); run = []; head = false; }
      }
      if (run.length > 1) out.push(piece(it, run, head, true));
      continue;
    }
    // to the nearest crossing on each side of where the eraser touched, like inking apps do
    let hit = 0, best = Infinity;
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1], b = ps[i], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      const f = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
      const dd = Math.hypot(x - a[0] - f * dx, y - a[1] - f * dy);
      if (dd < best) { best = dd; hit = i - 1 + f; }
    }
    const ts: number[] = [];
    for (const o of its) {
      if (o.k !== "s") continue;
      const qs = decode(o.pts);
      for (let i = 1; i < ps.length; i++) for (let j = 1; j < qs.length; j++) {
        if (o === it && Math.abs(i - j) < 2) continue;
        const t = cross(ps[i - 1], ps[i], qs[j - 1], qs[j]);
        if (t != null) ts.push(i - 1 + t);
      }
    }
    const lo = Math.max(-1, ...ts.filter(t => t < hit - 1e-6)), hi = Math.min(Infinity, ...ts.filter(t => t > hit + 1e-6));
    if (lo > 0) out.push(piece(it, slice(ps, 0, lo), true, false));
    if (hi < ps.length - 1) out.push(piece(it, slice(ps, hi, ps.length - 1), false, true));
  }
  if (changed) l.items = out;
  return changed;
}
