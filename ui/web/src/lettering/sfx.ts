/* Sound effects: text along a drawn baseline, each glyph with its own scale, turn and offset, and the
   hand-drawn treatments (envelope warp, roughened edges, paper-then-ink double outline, speed trail).
   Everything stays parameters on the text layer, so the SFX remains editable text. */
import type { Layer } from "../types.ts";
import { type Pt, hashStr, rng } from "./geom.ts";
import { type Path, length as pathLength, pointAt } from "../core/geometry/path.ts";
import { type GlyphDraw, type Measure, type Paint, drawLaid, fitLayout, boxShape } from "./layout.ts";
import { plainText, isCJK } from "./ruby.ts";

export const WARPS: [string, string][] = [["none", "None"], ["arch", "Arch"], ["bulge", "Bulge"], ["pinch", "Pinch"], ["wave", "Wave"], ["grow", "Grow (perspective)"]];
/** Baselines in box fractions: [p0, c1, c2, p3]. */
export const CURVES: [string, string, Pt[]][] = [
  ["straight", "Straight", [[-0.45, 0], [-0.15, 0], [0.15, 0], [0.45, 0]]],
  ["arc", "Arc", [[-0.45, 0.25], [-0.2, -0.35], [0.2, -0.35], [0.45, 0.25]]],
  ["sag", "Sag", [[-0.45, -0.2], [-0.2, 0.35], [0.2, 0.35], [0.45, -0.2]]],
  ["s", "S-curve", [[-0.45, 0.2], [-0.1, -0.6], [0.1, 0.6], [0.45, -0.2]]],
  ["rise", "Rising", [[-0.45, 0.35], [-0.1, 0.2], [0.15, -0.05], [0.45, -0.35]]],
  ["down", "Vertical", [[0, -0.45], [0.05, -0.15], [-0.05, 0.15], [0, 0.45]]],
];

export interface GlyphTweak { s?: number; r?: number; dx?: number; dy?: number }

const LAST = new Map<string, { draws: GlyphDraw[]; px: number }>();
/** Where each glyph of an SFX on a path was last drawn (box-centred page units), for the glyph handles. */
export const lastGlyphs = (id: string) => LAST.get(id);

/** A preset baseline as an open Path in the layer's frame. */
export function curvePath(pts: Pt[], w: number, h: number): Path {
  const P = (q: Pt): Pt => [+(q[0] * w).toFixed(2), +(q[1] * h).toFixed(2)];
  return { subs: [{ start: P(pts[0]), segs: [{ c1: P(pts[1]), c2: P(pts[2]), p: P(pts[3]) }], closed: false }] };
}

function arcTable(path: Path) {
  const len = pathLength(path);
  const atLen = (s: number): { p: Pt; a: number } => {
    const r = pointAt(path, Math.max(0, Math.min(len, s))) || { p: [0, 0] as Pt, t: [1, 0] as Pt };
    return { p: r.p, a: Math.atan2(r.t[1], r.t[0]) };
  };
  return { len, atLen };
}

function warpAt(kind: string, amt: number, t: number): { sc: number; off: number; a: number; sy: number } {
  const b = Math.sin(Math.PI * t);
  switch (kind) {
    case "arch": return { sc: 1, off: -amt * b, a: amt * Math.cos(Math.PI * t) * -0.9, sy: 1 };
    case "bulge": return { sc: 1 + amt * 0.8 * b, off: 0, a: 0, sy: 1 };
    case "pinch": return { sc: 1 - amt * 0.55 * b, off: 0, a: 0, sy: 1 };
    case "wave": return { sc: 1, off: amt * 0.45 * Math.sin(Math.PI * 3 * t), a: amt * 0.5 * Math.cos(Math.PI * 3 * t), sy: 1 };
    case "grow": return { sc: 1 + amt * (t - 0.5) * 1.3, off: 0, a: 0, sy: 1 };
    default: return { sc: 1, off: 0, a: 0, sy: 1 };
  }
}

/** Glyphs placed along the layer's curve, centred on the box centre. */
export function pathLayout(l: Layer, maxPx: number, measure: Measure): { draws: GlyphDraw[]; px: number } {
  const gs = [...plainText(l.text || "").replace(/\s*\n\s*/g, " ")];
  const { len, atLen } = arcTable(l.curve), V = !!l.vertical, track = l.tracking || 0;
  const adv1 = gs.map(g => V && isCJK(g) ? 1 : measure(g, 100) / 100);
  const sum1 = adv1.reduce((s, a) => s + a, 0) + track * Math.max(0, gs.length - 1);
  let px = l.fontSize > 0 ? l.fontSize : Math.min(maxPx, len * 0.96 / Math.max(0.3, sum1), (V ? l.w : l.h) * 0.85);
  px = Math.max(6, px);
  const total = sum1 * px, tw: GlyphTweak[] = l.glyphs || [], warp = l.warp || "none", amt = l.warpAmt ?? 0.5;
  let s = (len - total) / 2;
  const draws: GlyphDraw[] = gs.map((g, i) => {
    const a = adv1[i] * px, mid = s + a / 2; s += a + track * px;
    const { p, a: ang } = atLen(mid), W = warpAt(warp, amt, len ? mid / len : 0.5), T = tw[i] || {};
    const base = ang - (V ? Math.PI / 2 : 0) + W.a + (T.r || 0) * Math.PI / 180;
    const nx = -Math.sin(ang), ny = Math.cos(ang), tx = Math.cos(ang), ty = Math.sin(ang);
    const off = W.off * px + (T.dy || 0) * px, along = (T.dx || 0) * px;
    return { t: g, x: p[0] + nx * off + tx * along, y: p[1] + ny * off + ty * along, px, rot: V && !isCJK(g),
      free: { a: base, sc: W.sc * (T.s ?? 1), sy: W.sy } };
  });
  return { draws, px };
}

/* ---------------------------------------------------------------- rough edges */
function noiseGrid(gw: number, gh: number, r: () => number): Float32Array {
  const g = new Float32Array(gw * gh); for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1; return g;
}
function sample(g: Float32Array, gw: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const i = y0 * gw + x0, a = g[i], b = g[i + 1], c = g[i + gw], d = g[i + gw + 1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Pushes every pixel by smooth noise: ink edges wobble like a brush or marker, the letters stay legible. */
export function roughen(img: ImageData, amount: number, cell: number, seed: number): ImageData {
  const { width: W, height: H, data } = img, out = new ImageData(W, H), o = out.data, r = rng(seed);
  const oct = [[cell, 1], [cell / 3.2, 0.45]].map(([c, w]) => {
    const gw = Math.ceil(W / c) + 3, gh = Math.ceil(H / c) + 3;
    return { c, w, gw, gx: noiseGrid(gw, gh, r), gy: noiseGrid(gw, gh, r) };
  });
  const amp = amount * cell * 0.55;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let dx = 0, dy = 0;
    for (const q of oct) { dx += sample(q.gx, q.gw, x / q.c, y / q.c) * q.w; dy += sample(q.gy, q.gw, x / q.c, y / q.c) * q.w; }
    const sx = Math.round(x + dx * amp), sy = Math.round(y + dy * amp);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const si = (sy * W + sx) * 4, di = (y * W + x) * 4;
    o[di] = data[si]; o[di + 1] = data[si + 1]; o[di + 2] = data[si + 2]; o[di + 3] = data[si + 3];
  }
  return out;
}

const SPRITES = new Map<string, HTMLCanvasElement>();

/** Draws an SFX layer centred on the origin of ctx (the layer's own frame). */
export function drawSfx(ctx: CanvasRenderingContext2D, l: Layer, maxPx: number, color: string, measure: Measure, font: (px: number) => string): void {
  const curve = !!l.curve?.subs?.length;
  let laid: { draws: GlyphDraw[]; px: number };
  if (curve) { laid = pathLayout(l, maxPx, measure); LAST.set(l.id, laid); }
  else {
    const f = fitLayout(String(l.text || ""), boxShape(l.w, l.h), maxPx, l.fontSize > 0 ? l.fontSize : 0,
      { vertical: !!l.vertical, align: l.align, tracking: l.tracking || 0 }, measure);
    laid = f; LAST.delete(l.id);
  }
  const paint: Paint = { fill: color, stroke: l.stroke, strokeW: l.strokeWidth || 0, paper: l.paper || "#ffffff", paperW: l.paperW || 0, font };
  const vertical = !!l.vertical && !curve;
  const rough = l.rough || 0, trail = l.trail || 0;
  if (!rough && !trail) { drawLaid(ctx, laid, 0, 0, paint, vertical); return; }

  const T = ctx.getTransform(), k = Math.min(4, Math.max(0.05, Math.hypot(T.a, T.b)));
  const m = laid.px * 0.9 + (paint.strokeW || 0) + (paint.paperW || 0);
  const W = l.w + m * 2, H = l.h + m * 2, scale = Math.min(k, 4096 / Math.max(W, H));
  const key = hashStr(JSON.stringify([l.text, l.font, l.bold, l.italic, l.fontSize, l.vertical, l.curve, l.glyphs, l.warp, l.warpAmt, l.tracking,
    l.stroke, l.strokeWidth, l.paper, l.paperW, rough, l.seed, color, l.w, l.h, laid.px, Math.round(scale * 20)]));
  let sp = SPRITES.get(key);
  if (!sp) {
    sp = document.createElement("canvas");
    sp.width = Math.max(1, Math.ceil(W * scale)); sp.height = Math.max(1, Math.ceil(H * scale));
    const g = sp.getContext("2d", { willReadFrequently: true })!;
    g.scale(scale, scale);
    drawLaid(g, laid, W / 2, H / 2, paint, vertical);
    if (rough > 0) g.putImageData(roughen(g.getImageData(0, 0, sp.width, sp.height), rough, Math.max(4, laid.px * scale * 0.22), l.seed || 1), 0, 0);
    if (SPRITES.size > 60) SPRITES.clear();
    SPRITES.set(key, sp);
  }
  if (trail > 0) {
    const a = ((l.trailDir ?? 180) * Math.PI) / 180, L = (l.trailLen ?? 1.2) * laid.px, base = ctx.globalAlpha;
    for (let i = trail; i >= 1; i--) {
      ctx.globalAlpha = base * 0.55 * (1 - i / (trail + 1));
      ctx.drawImage(sp, -W / 2 + Math.cos(a) * L * i / trail, -H / 2 + Math.sin(a) * L * i / trail, W, H);
    }
    ctx.globalAlpha = base;
  }
  ctx.drawImage(sp, -W / 2, -H / 2, W, H);
}
