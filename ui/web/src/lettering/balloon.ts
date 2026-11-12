/* Balloons with editable outlines: a preset (or a traced template) becomes nodes the user drags, tails are
   separate shapes with a tip, and balloons that overlap share one merged outline. */
import type { Layer } from "../types.ts";
import { type Node, type Pt, bbox, centroid, chord, hashStr, inPoly, nodesToPath, polyToNodes, presetNodes, rayHit, simplify, traceMask } from "./geom.ts";
import { type Path, flatten, toPath2D } from "../core/geometry/path.ts";
import type { Shape } from "./layout.ts";

export interface Tail { kind: "curved" | "straight" | "dots"; tip: { x: number; y: number }; width: number; bend: number }

interface Geo { body: Path2D; poly: Pt[]; c: Pt; bb: { x0: number; y0: number; x1: number; y1: number } }
const GEO = new Map<string, Geo>();

export function geo(l: Layer): Geo {
  const key = hashStr(JSON.stringify(l.path));
  let g = GEO.get(key);
  if (g) return g;
  const path: Path = l.path, poly = (flatten(path, 0.6)[0]?.pts || [[0, 0]]) as Pt[];
  g = { body: toPath2D(path), poly, c: centroid(poly), bb: bbox(poly) };
  if (GEO.size > 400) GEO.clear();
  GEO.set(key, g);
  return g;
}

export function tailPaths(l: Layer, t: Tail, open = false): Path2D[] {
  const g = geo(l), [cx, cy] = g.c, rx = (g.bb.x1 - g.bb.x0) / 2, ry = (g.bb.y1 - g.bb.y0) / 2;
  const tx = t.tip.x, ty = t.tip.y, th = Math.atan2((ty - cy) / ry, (tx - cx) / rx);
  const edge = (a: number, k: number): Pt => {
    const dx = Math.cos(a) * rx, dy = Math.sin(a) * ry, r = rayHit(g.poly, g.c, dx, dy) * k, L = Math.hypot(dx, dy) || 1;
    return [cx + dx / L * r, cy + dy / L * r];
  };
  if (t.kind === "dots") {
    const b = edge(th, 1.04), out: Path2D[] = [], s = Math.min(rx, ry);
    for (let i = 1; i <= 3; i++) {
      const f = i / 3.2, rr = s * (0.2 - i * 0.044);
      const p = new Path2D(); p.ellipse(b[0] + (tx - b[0]) * f, b[1] + (ty - b[1]) * f, rr * 1.3, rr, 0, 0, Math.PI * 2); out.push(p);
    }
    return out;
  }
  const d = (t.width || 0.22) * 1.1, b1 = edge(th - d, 0.85), b2 = edge(th + d, 0.85);
  const mx = (b1[0] + b2[0]) / 2, my = (b1[1] + b2[1]) / 2, bend = t.kind === "straight" ? 0 : (t.bend ?? 0.18);
  const nx = -(ty - my) * bend, ny = (tx - mx) * bend, p = new Path2D();
  p.moveTo(b1[0], b1[1]);
  p.quadraticCurveTo((b1[0] + tx) / 2 + nx, (b1[1] + ty) / 2 + ny, tx, ty);
  p.quadraticCurveTo((b2[0] + tx) / 2 + nx * 0.6, (b2[1] + ty) / 2 + ny * 0.6, b2[0], b2[1]);
  if (open) return [p];                     // the outline leaves the base open: it lies inside the body
  p.lineTo(cx, cy);                         // the fill reaches the centre, so no notch of the outline stays uncovered
  p.closePath();
  return [p];
}

/** The inside of the outline, inset, for fitting text: each column or line gets its own length. */
export function textShape(l: Layer): Shape & { cx: number; cy: number } {
  const g = geo(l), pad = Math.max((l.strokeW || 0) * 1.5, Math.min(g.bb.x1 - g.bb.x0, g.bb.y1 - g.bb.y0) * 0.09);
  const [cx, cy] = g.c, w = g.bb.x1 - g.bb.x0 - pad * 2, h = g.bb.y1 - g.bb.y0 - pad * 2;
  const key = "poly" + hashStr(JSON.stringify(l.path)) + "|" + (l.strokeW || 0);
  const span = (pos: number, thick: number, vertical: boolean): [number, number] | null => {
    let lo = -Infinity, hi = Infinity;
    for (const f of [-0.42, 0, 0.42]) {
      const c = vertical ? chord(g.poly, cx + pos + f * thick, cy, true) : chord(g.poly, cy + pos + f * thick, cx, false);
      if (!c) return null;
      const o = vertical ? cy : cx;
      lo = Math.max(lo, c[0] - o + pad); hi = Math.min(hi, c[1] - o - pad);
    }
    return hi > lo ? [lo, hi] : null;
  };
  return { w, h, key, span, cx, cy };
}

/** Balloons on the page that overlap this one, through any chain of overlaps, in stacking order. */
export function mergeGroup(l: Layer, all: Layer[]): Layer[] {
  if (l.merge === false) return [l];
  const cand = all.filter(q => q.type === "balloon" && q.visible !== false && q.merge !== false);
  const polys = new Map(cand.map(q => [q.id, pagePoly(q)]));
  const touch = (a: Layer, b: Layer) => {
    const A = polys.get(a.id)!, B = polys.get(b.id)!;
    return A.some(p => inPoly(p, B)) || B.some(p => inPoly(p, A));
  };
  const seen = new Set([l.id]), queue = [l];
  while (queue.length) {
    const a = queue.pop()!;
    for (const b of cand) if (!seen.has(b.id) && touch(a, b)) { seen.add(b.id); queue.push(b); }
  }
  return cand.filter(q => seen.has(q.id));
}
function pagePoly(l: Layer): Pt[] {
  const g = geo(l), a = (l.rotate || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  return g.poly.filter((_, i) => i % 2 === 0).map(([x, y]): Pt => [cx + x * c - y * s, cy + x * s + y * c]);
}

const inBox = (ctx: CanvasRenderingContext2D, l: Layer, fn: () => void) => {
  ctx.save(); ctx.translate(l.x + l.w / 2, l.y + l.h / 2); if (l.rotate) ctx.rotate(l.rotate * Math.PI / 180); fn(); ctx.restore();
};

/** Outlines first, then fills, so where balloons overlap the lines inside disappear; then each text. */
export function drawBalloons(ctx: CanvasRenderingContext2D, ls: Layer[], text: (l: Layer) => void): void {
  for (const l of ls) inBox(ctx, l, () => {
    if (!(l.strokeW > 0)) return;
    ctx.lineJoin = "round"; ctx.lineWidth = l.strokeW; ctx.strokeStyle = l.stroke;
    if (l.dash) ctx.setLineDash([l.strokeW * 3, l.strokeW * 2.2]);
    for (const t of l.tails || []) if (t.kind !== "dots") for (const p of tailPaths(l, t, true)) ctx.stroke(p);
    ctx.stroke(geo(l).body);
    ctx.setLineDash([]);
  });
  for (const l of ls) inBox(ctx, l, () => {
    ctx.fillStyle = l.fill;
    for (const t of l.tails || []) for (const p of tailPaths(l, t)) { ctx.fill(p); if (t.kind === "dots" && l.strokeW > 0) { ctx.lineWidth = l.strokeW; ctx.strokeStyle = l.stroke; ctx.stroke(p); } }
    ctx.fill(geo(l).body);
  });
  for (const l of ls) inBox(ctx, l, () => text(l));
}

/* ---------------------------------------------------------------- making balloons */
export function newTail(l: Layer, kind: Tail["kind"] = "curved"): Tail {
  const n = (l.tails || []).length, side = n % 2 ? 1 : -1;
  return { kind, tip: { x: side * l.w * 0.18, y: l.h * 0.85 }, width: 0.22, bend: 0.18 };
}

/** A drawn bubble (vbubble) as an editable balloon: same look, outline now made of nodes. */
export function fromVBubble(l: Layer): Layer {
  const preset = l.shape === "whisper" ? "oval" : l.shape;
  const b: Layer = { ...l, type: "balloon", preset: l.shape, path: nodesToPath(presetNodes(preset, l.w, l.h, l.seed, l.spikes), l.w, l.h), dash: l.shape === "whisper",
    tails: l.tail ? [{ kind: l.shape === "cloud" ? "dots" : "curved", tip: { ...l.tail }, width: l.tailW ?? 0.22, bend: 0.18 }] : [] };
  delete b.shape; delete b.tail; delete b.tailW;
  return b;
}

/** Traces a template bubble's picture into nodes: its filled area, outer edge only. */
export async function traceImage(src: string): Promise<{ nodes: Node[]; dark: boolean; aspect: number } | null> {
  const im = new Image(); im.crossOrigin = "anonymous"; im.src = src;
  try { await im.decode(); } catch { return null; }
  const W = 360, H = Math.max(8, Math.round(W * im.naturalHeight / im.naturalWidth));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(im, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data, mask = new Uint8Array(W * H);
  const transparent = px[3] < 128;
  const [r0, g0, b0] = [px[0], px[1], px[2]];
  let lumSum = 0, cnt = 0;
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3];
    const on = transparent ? a >= 128 : Math.abs(r - r0) + Math.abs(gg - g0) + Math.abs(b - b0) > 60;
    if (on) { mask[i] = 1; lumSum += (r * 0.3 + gg * 0.59 + b * 0.11); cnt++; }
  }
  /* close the outline: fill holes enclosed by the drawn line (the bubble's white inside on white paper) */
  const out = new Uint8Array(W * H), st: number[] = [];
  for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
  while (st.length) {
    const p = st.pop()!;
    if (out[p] || mask[p]) continue;
    out[p] = 1;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (y > 0) st.push(p - W); if (y < H - 1) st.push(p + W);
  }
  for (let i = 0; i < W * H; i++) mask[i] = out[i] ? 0 : 1;
  const poly = traceMask(mask, W, H);
  if (poly.length < 8) return null;
  const simple = simplify(poly, Math.max(W, H) * 0.006);
  return { nodes: polyToNodes(simple, W, H), dark: cnt > 0 && lumSum / cnt < 90, aspect: W / H };
}

