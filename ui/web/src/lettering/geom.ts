/* Bezier outlines for balloons and SFX baselines. Pure maths, no canvas. */
import type { Path, Seg } from "../core/geometry/path.ts";

export type Pt = [number, number];
/** A point on a closed outline; i/o are its handles, relative to the point. Coordinates are fractions of
    the layer box (-0.5 .. 0.5), so resizing the layer stretches the outline with it. */
export interface Node { x: number; y: number; i?: Pt; o?: Pt }

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function cubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}
export function cubicTangent(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return [3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0]),
    3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1])];
}

/** Segment k of a closed outline in box units: [p0, c1, c2, p3]. */
export function segment(nodes: Node[], k: number): [Pt, Pt, Pt, Pt] {
  const a = nodes[k], b = nodes[(k + 1) % nodes.length];
  return [[a.x, a.y], [a.x + (a.o?.[0] || 0), a.y + (a.o?.[1] || 0)], [b.x + (b.i?.[0] || 0), b.y + (b.i?.[1] || 0)], [b.x, b.y]];
}

export function flatten(nodes: Node[], w: number, h: number, steps = 12): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < nodes.length; k++) {
    const s = segment(nodes, k), straight = !nodes[k].o && !nodes[(k + 1) % nodes.length].i;
    const n = straight ? 1 : steps;
    for (let j = 0; j < n; j++) { const p = cubic(...s, j / n); out.push([p[0] * w, p[1] * h]); }
  }
  return out;
}

export function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Area centroid of a polygon; the text of a balloon centres here, so a traced tail does not pull it off. */
export function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f; cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function bbox(poly: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/* ---------------------------------------------------------------- presets */
export const PRESETS: [string, string][] = [["oval", "Oval (speech)"], ["box", "Rounded box"], ["cloud", "Cloud (thought)"],
  ["burst", "Burst (shout)"], ["whisper", "Dashed (whisper)"], ["flash", "Flash (inner voice)"], ["wavy", "Wavy (nervous)"], ["rect", "Square box (narration)"]];

function ellipseNodes(n: number, r = 0.5): Node[] {
  const k = 4 / 3 * Math.tan(Math.PI / (2 * n)) * r, out: Node[] = [];
  for (let j = 0; j < n; j++) {
    const a = j / n * Math.PI * 2, tx = -Math.sin(a) * k, ty = Math.cos(a) * k;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, i: [-tx, -ty], o: [tx, ty] });
  }
  return out;
}

export function presetNodes(kind: string, w: number, h: number, seed = 1, spikes = 16): Node[] {
  const r = rng(seed);
  if (kind === "rect") return [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
  if (kind === "box") {
    const rad = Math.min(w, h) * 0.14, rx = rad / w, ry = rad / h, kx = rx * 0.5523, ky = ry * 0.5523;
    return [
      { x: -0.5 + rx, y: -0.5, i: [-kx, 0] }, { x: 0.5 - rx, y: -0.5, o: [kx, 0] },
      { x: 0.5, y: -0.5 + ry, i: [0, -ky] }, { x: 0.5, y: 0.5 - ry, o: [0, ky] },
      { x: 0.5 - rx, y: 0.5, i: [kx, 0] }, { x: -0.5 + rx, y: 0.5, o: [-kx, 0] },
      { x: -0.5, y: 0.5 - ry, i: [0, ky] }, { x: -0.5, y: -0.5 + ry, o: [0, -ky] },
    ];
  }
  if (kind === "cloud") {
    const n = Math.max(9, Math.min(24, Math.round((w + h) / (Math.min(w, h) * 0.3)))), out: Node[] = [], R = 0.43;
    for (let j = 0; j < n; j++) {
      const a = (j + (r() - 0.5) * 0.3) / n * Math.PI * 2;
      out.push({ x: Math.cos(a) * R, y: Math.sin(a) * R });
    }
    for (let j = 0; j < n; j++) {
      const a = out[j], b = out[(j + 1) % n], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(mx, my) || 1;
      const bulge = 0.09 + r() * 0.03, ox = mx / len * bulge, oy = my / len * bulge;
      a.o = [(mx - a.x) * 0.3 + ox, (my - a.y) * 0.3 + oy];
      b.i = [(mx - b.x) * 0.3 + ox, (my - b.y) * 0.3 + oy];
    }
    return out;
  }
  if (kind === "burst" || kind === "flash") {
    const n = kind === "flash" ? Math.max(spikes, 24) * 2 : spikes, out: Node[] = [];
    for (let j = 0; j < n * 2; j++) {
      const a = j / (n * 2) * Math.PI * 2, outer = j % 2 === 0;
      const f = kind === "flash" ? (outer ? 0.5 + r() * 0.06 : 0.44) : (outer ? 0.49 + r() * 0.15 : 0.37 + r() * 0.03);
      out.push({ x: Math.cos(a) * f, y: Math.sin(a) * f });
    }
    return out;
  }
  if (kind === "wavy") {
    const n = 22, out: Node[] = [];
    for (let j = 0; j < n; j++) {
      const a = j / n * Math.PI * 2, f = j % 2 ? 0.46 : 0.5, k = 4 / 3 * Math.tan(Math.PI / (2 * n)) * f;
      out.push({ x: Math.cos(a) * f, y: Math.sin(a) * f, i: [Math.sin(a) * k, -Math.cos(a) * k], o: [-Math.sin(a) * k, Math.cos(a) * k] });
    }
    return out;
  }
  return ellipseNodes(8);
}

/* ---------------------------------------------------------------- editing */
/** Splits segment k at t (de Casteljau), adding a node and keeping the curve's shape. */
export function splitSegment(nodes: Node[], k: number, t: number): Node[] {
  const [p0, c1, c2, p3] = segment(nodes, k);
  const L = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a = L(p0, c1), b = L(c1, c2), c = L(c2, p3), d = L(a, b), e = L(b, c), m = L(d, e);
  const out = nodes.map(n => ({ ...n }));
  const A = out[k], B = out[(k + 1) % out.length], curved = !!(A.o || B.i);
  if (curved) { A.o = [a[0] - p0[0], a[1] - p0[1]]; B.i = [c[0] - p3[0], c[1] - p3[1]]; }
  const mid: Node = curved ? { x: m[0], y: m[1], i: [d[0] - m[0], d[1] - m[1]], o: [e[0] - m[0], e[1] - m[1]] } : { x: m[0], y: m[1] };
  out.splice(k + 1, 0, mid);
  return out;
}

/** Closest point of the outline to q (box units): segment index, t and distance in px. */
export function nearest(nodes: Node[], w: number, h: number, q: Pt): { k: number; t: number; d: number } {
  let best = { k: 0, t: 0, d: Infinity };
  for (let k = 0; k < nodes.length; k++) {
    const s = segment(nodes, k);
    for (let j = 0; j <= 40; j++) {
      const t = j / 40, p = cubic(...s, t), d = Math.hypot((p[0] - q[0]) * w, (p[1] - q[1]) * h);
      if (d < best.d) best = { k, t, d };
    }
  }
  return best;
}

/** Turns a corner point smooth (handles along its neighbours) or a smooth point into a corner. */
export function toggleSmooth(nodes: Node[], k: number): Node[] {
  const out = nodes.map(n => ({ ...n })), n = out[k];
  if (n.i || n.o) { delete n.i; delete n.o; return out; }
  const p = out[(k - 1 + out.length) % out.length], q = out[(k + 1) % out.length];
  const dx = (q.x - p.x) / 6, dy = (q.y - p.y) / 6;
  n.i = [-dx, -dy]; n.o = [dx, dy];
  return out;
}

/* ---------------------------------------------------------------- tracing template bubbles */
/** Outer outline of the largest filled region of a mask (1 byte per pixel, non-zero = inside). */
export function traceMask(mask: Uint8Array, w: number, h: number): Pt[] {
  const lab = new Int32Array(w * h), sizes = [0];
  let id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s]) continue;
    id++; let n = 0; const st = [s]; lab[s] = id;
    while (st.length) {
      const p = st.pop()!; n++;
      const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X;
        if (mask[q] && !lab[q]) { lab[q] = id; st.push(q); }
      }
    }
    sizes.push(n);
  }
  if (!id) return [];
  let big = 1;
  for (let k = 2; k <= id; k++) if (sizes[k] > sizes[big]) big = k;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === big;
  let start = -1;
  for (let s = 0; s < w * h; s++) if (lab[s] === big) { start = s; break; }
  /* Moore neighbour tracing, clockwise */
  const D: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const sx = start % w, sy = (start / w) | 0, out: Pt[] = [[sx, sy]];
  let x = sx, y = sy, dir = 7;
  for (let guard = 0; guard < w * h * 4; guard++) {
    let found = false;
    for (let j = 0; j < 8; j++) {
      const d = (dir + 6 + j) % 8, X = x + D[d][0], Y = y + D[d][1];
      if (inside(X, Y)) { x = X; y = Y; dir = d; found = true; break; }
    }
    if (!found || (x === sx && y === sy)) break;
    out.push([x, y]);
  }
  return out;
}

/** Ramer-Douglas-Peucker on a closed polygon. */
export function simplify(poly: Pt[], eps: number): Pt[] {
  if (poly.length < 4) return poly;
  const rdp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    let idx = 0, dm = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
      if (d > dm) { dm = d; idx = i; }
    }
    if (dm <= eps) return [a, b];
    return [...rdp(pts.slice(0, idx + 1)).slice(0, -1), ...rdp(pts.slice(idx))];
  };
  let far = 0, fd = 0;
  for (let i = 1; i < poly.length; i++) { const d = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]); if (d > fd) { fd = d; far = i; } }
  const A = rdp(poly.slice(0, far + 1)), B = rdp([...poly.slice(far), poly[0]]);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}

/** Polygon in image pixels -> editable nodes in box units; gentle bends become smooth points. */
export function polyToNodes(poly: Pt[], w: number, h: number): Node[] {
  const n = poly.length, out: Node[] = [];
  for (let k = 0; k < n; k++) {
    const p = poly[(k - 1 + n) % n], c = poly[k], q = poly[(k + 1) % n];
    const a1 = Math.atan2(c[1] - p[1], c[0] - p[0]), a2 = Math.atan2(q[1] - c[1], q[0] - c[0]);
    let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const node: Node = { x: c[0] / w - 0.5, y: c[1] / h - 0.5 };
    if (turn < 0.9) { const dx = (q[0] - p[0]) / 6 / w, dy = (q[1] - p[1]) / 6 / h; node.i = [-dx, -dy]; node.o = [dx, dy]; }
    out.push(node);
  }
  return out;
}

export function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The inside stretch of a polygon along the line x = pos (vertical) or y = pos that holds `at`, or null. */
export function chord(poly: Pt[], pos: number, at: number, vertical: boolean): [number, number] | null {
  const xs: number[] = [];
  const A = vertical ? 0 : 1, B = vertical ? 1 : 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j], q = poly[i];
    if ((p[A] > pos) !== (q[A] > pos)) xs.push(p[B] + (pos - p[A]) / (q[A] - p[A]) * (q[B] - p[B]));
  }
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k] <= at && at <= xs[k + 1]) return [xs[k], xs[k + 1]];
  return null;
}

/** Distance from c along direction (dx, dy) to the outline. */
export function rayHit(poly: Pt[], c: Pt, dx: number, dy: number): number {
  let best = Infinity;
  const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j], q = poly[i], ex = q[0] - p[0], ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - c[0]) * ey - (p[1] - c[1]) * ex) / den, u = ((p[0] - c[0]) * dy - (p[1] - c[1]) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best === Infinity ? 0 : best;
}

/* ---------------------------------------------------------------- to and from the shared Path type */

/** Nodes in box fractions -> a closed Path in the layer's frame (px, centred), with an explicit closing segment. */
export function nodesToPath(nodes: Node[], w: number, h: number): Path {
  const P = (x: number, y: number): Pt => [+(x * w).toFixed(2), +(y * h).toFixed(2)];
  const segs: Seg[] = nodes.map((a, k) => {
    const b = nodes[(k + 1) % nodes.length], p = P(b.x, b.y);
    if (!a.o && !b.i) return { p };
    return { c1: P(a.x + (a.o?.[0] || 0), a.y + (a.o?.[1] || 0)), c2: P(b.x + (b.i?.[0] || 0), b.y + (b.i?.[1] || 0)), p };
  });
  return { subs: [{ start: P(nodes[0].x, nodes[0].y), segs, closed: true }] };
}
export function scalePath(p: Path, sx: number, sy: number): Path {
  const S = (q?: Pt): Pt | undefined => q && [+(q[0] * sx).toFixed(2), +(q[1] * sy).toFixed(2)];
  return { subs: p.subs.map(sp => ({ ...sp, start: S(sp.start)!, segs: sp.segs.map(s => ({ ...(s.c1 ? { c1: S(s.c1), c2: S(s.c2) } : {}), p: S(s.p)! })) })) };
}
