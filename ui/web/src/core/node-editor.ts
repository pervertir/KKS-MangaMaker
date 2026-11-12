import type { Pt } from "./geometry/region.ts";
import { clone, nearest, splitAt, type Path } from "./geometry/path.ts";

/** Which point of a path: an anchor, or the handle going into ("in") or out of ("out") an anchor. Anchor 0 is the subpath's start. */
export interface NodeRef { sub: number; anchor: number; part: "anchor" | "in" | "out" }

/** Anchors are start, then each segment's end; on a closed path that repeats its start as the last segment's end,
 *  that last anchor is the start again and the two move together. */
const lastIsStart = (path: Path, sub: number) => {
  const sp = path.subs[sub], n = sp.segs.length;
  return sp.closed && n > 0 && sp.segs[n - 1].p[0] === sp.start[0] && sp.segs[n - 1].p[1] === sp.start[1];
};
export function anchorCount(path: Path, sub: number): number { return path.subs[sub].segs.length + 1 - (lastIsStart(path, sub) ? 1 : 0); }
export function anchorAt(path: Path, sub: number, k: number): Pt { return k === 0 ? path.subs[sub].start : path.subs[sub].segs[k - 1].p; }
/** The segment index whose c1 is anchor k's out handle, and whose c2 is its in handle (null at open ends). */
function segOut(path: Path, sub: number, k: number): number | null { const n = path.subs[sub].segs.length; return k < n ? k : null; }
function segIn(path: Path, sub: number, k: number): number | null {
  const sp = path.subs[sub], n = sp.segs.length;
  if (k > 0) return k - 1;
  if (!sp.closed || !n) return null;
  return lastIsStart(path, sub) ? n - 1 : null;
}
export function handleAt(path: Path, r: NodeRef): Pt | null {
  const sp = path.subs[r.sub];
  if (r.part === "anchor") return anchorAt(path, r.sub, r.anchor);
  const s = r.part === "out" ? segOut(path, r.sub, r.anchor) : segIn(path, r.sub, r.anchor);
  if (s === null) return null;
  return (r.part === "out" ? sp.segs[s].c1 : sp.segs[s].c2) ?? null;
}

/** Every point the editor shows, in path coordinates. */
export function nodes(path: Path): (NodeRef & { pt: Pt })[] {
  const out: (NodeRef & { pt: Pt })[] = [];
  path.subs.forEach((_, sub) => {
    for (let k = 0; k < anchorCount(path, sub); k++) for (const part of ["anchor", "in", "out"] as const) {
      const pt = handleAt(path, { sub, anchor: k, part }); if (pt) out.push({ sub, anchor: k, part, pt });
    }
  });
  return out;
}
export function hitNode(path: Path, x: number, y: number, r: number): NodeRef | null {
  let best: NodeRef | null = null, bd = r;
  for (const n of nodes(path)) {
    const d = Math.hypot(n.pt[0] - x, n.pt[1] - y);
    if (d < bd || (d <= bd && best && best.part !== "anchor" && n.part === "anchor")) { best = { sub: n.sub, anchor: n.anchor, part: n.part }; bd = d; }
  }
  return best;
}

/** Moves a node to `to`. An anchor carries its handles; a handle on a smooth anchor turns its partner to stay opposite. */
export function moveNode(path: Path, r: NodeRef, to: Pt, smooth = true): Path {
  const p = clone(path), sp = p.subs[r.sub];
  const k = r.anchor, si = segIn(p, r.sub, k), so = segOut(p, r.sub, k);
  const a = anchorAt(p, r.sub, k);
  if (r.part === "anchor") {
    const dx = to[0] - a[0], dy = to[1] - a[1];
    const mv = (q?: Pt) => q && (q[0] += dx, q[1] += dy);
    if (si !== null) mv(sp.segs[si].c2);
    if (so !== null) mv(sp.segs[so].c1);
    if (k === 0) { sp.start = [to[0], to[1]]; if (lastIsStart(path, r.sub)) sp.segs[sp.segs.length - 1].p = [to[0], to[1]]; }
    else sp.segs[k - 1].p = [to[0], to[1]];
    return p;
  }
  const own = r.part === "out" ? so : si, other = r.part === "out" ? si : so;
  if (own === null) return p;
  if (r.part === "out") sp.segs[own].c1 = [to[0], to[1]]; else sp.segs[own].c2 = [to[0], to[1]];
  if (smooth && other !== null) {
    const q = r.part === "out" ? sp.segs[other].c2 : sp.segs[other].c1;
    if (q) {
      const L = Math.hypot(q[0] - a[0], q[1] - a[1]), dx = a[0] - to[0], dy = a[1] - to[1], n = Math.hypot(dx, dy) || 1;
      const m: Pt = [a[0] + dx / n * L, a[1] + dy / n * L];
      if (r.part === "out") sp.segs[other].c2 = m; else sp.segs[other].c1 = m;
    }
  }
  return p;
}
/** Adds an anchor on the outline nearest (x, y) when it is within r. */
export function insertNode(path: Path, x: number, y: number, r: number): { path: Path; ref: NodeRef } | null {
  const n = nearest(path, x, y);
  if (!n || n.d > r || n.t <= 0.001 || n.t >= 0.999) return null;
  return { path: splitAt(path, n.sub, n.seg, n.t), ref: { sub: n.sub, anchor: n.seg + 1, part: "anchor" } };
}
/** Removes an anchor, joining its neighbours (keeps at least two anchors, three on a closed path). */
export function deleteNode(path: Path, r: NodeRef): Path {
  const p = clone(path), sp = p.subs[r.sub], n = anchorCount(p, r.sub);
  if (n <= (sp.closed ? 3 : 2)) return p;
  const k = r.anchor, ls = lastIsStart(path, r.sub);
  if (k === 0) {
    const first = sp.segs.shift()!; sp.start = first.p;
    if (ls) { const last = sp.segs[sp.segs.length - 1]; last.p = [first.p[0], first.p[1]]; last.c2 = first.c2; }
    return p;
  }
  const a = sp.segs[k - 1], b = sp.segs[k];
  if (b) sp.segs.splice(k - 1, 2, { c1: a.c1, c2: b.c2, p: b.p });
  else sp.segs.splice(k - 1, 1);
  if (sp.segs.length && !sp.segs.some(s => s.c1 || s.c2)) sp.segs.forEach(s => { delete s.c1; delete s.c2; });
  sp.segs.forEach(s => { if (!(s.c1 && s.c2)) { delete s.c1; delete s.c2; } });
  return p;
}
/** Turns a corner into a smooth point (handles along the neighbours' direction) or a smooth point into a corner. */
export function toggleSmooth(path: Path, r: NodeRef): Path {
  const p = clone(path), sp = p.subs[r.sub], k = r.anchor;
  const si = segIn(p, r.sub, k), so = segOut(p, r.sub, k), a = anchorAt(p, r.sub, k);
  const hasCurve = (si !== null && sp.segs[si].c2) || (so !== null && sp.segs[so].c1);
  const prevA = si !== null ? (si === 0 ? sp.start : sp.segs[si - 1].p) : null;
  const nextA = so !== null ? sp.segs[so].p : null;
  const ensure = (s: number) => {
    const seg = sp.segs[s], from = s === 0 ? sp.start : sp.segs[s - 1].p;
    seg.c1 ??= [from[0] + (seg.p[0] - from[0]) / 3, from[1] + (seg.p[1] - from[1]) / 3];
    seg.c2 ??= [from[0] + (seg.p[0] - from[0]) * 2 / 3, from[1] + (seg.p[1] - from[1]) * 2 / 3];
  };
  if (hasCurve) {
    if (si !== null && sp.segs[si].c2) sp.segs[si].c2 = [a[0], a[1]];
    if (so !== null && sp.segs[so].c1) sp.segs[so].c1 = [a[0], a[1]];
    return p;
  }
  const A = prevA ?? a, B = nextA ?? a, dx = (B[0] - A[0]) / 6, dy = (B[1] - A[1]) / 6;
  if (si !== null) { ensure(si); sp.segs[si].c2 = [a[0] - dx, a[1] - dy]; }
  if (so !== null) { ensure(so); sp.segs[so].c1 = [a[0] + dx, a[1] + dy]; }
  return p;
}

/** A layer-local frame: paths stored relative to a box (lettering keeps balloon paths centred on the layer, unrotated). */
export interface Frame { toPage(p: Pt): Pt; toLocal(p: Pt): Pt }
export const identityFrame: Frame = { toPage: p => p, toLocal: p => p };
/** Frame of a layer box whose path coordinates have the box centre at 0,0, unrotated. */
export function boxFrame(l: { x: number; y: number; w: number; h: number; rotate?: number }): Frame {
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2, a = (l.rotate || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { toPage: ([x, y]) => [cx + x * c - y * s, cy + x * s + y * c], toLocal: ([x, y]) => { const dx = x - cx, dy = y - cy; return [dx * c + dy * s, -dx * s + dy * c]; } };
}
