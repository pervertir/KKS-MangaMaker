/* Screentone engine. A tone is described the way print describes it: lines per inch, coverage percent,
   screen angle and dot shape. Cells are sized from the document's resolution, so the pattern is generated
   at the size it is printed (export draws at 1 device px per page px) and never resampled. On screen the
   pattern is generated at the view scale; once a cell is smaller than a few device pixels it is drawn as
   the flat grey it averages to, which is what the eye sees anyway and avoids moiré. */
import { clamp, lerp, noise2, rng, type Pt } from "./geom.ts";

export type ToneShape = "round" | "square" | "line" | "cross" | "noise" | "cloud" | "sparkle" | "stars" | "flat" | "tile";
export type Stop = [number, number];                      // [position 0..1, coverage %]
export interface Gradient { kind: "linear" | "radial"; a: Pt; b: Pt; stops: Stop[] }
export interface ToneSpec { shape: ToneShape; lpi: number; pct: number; angle: number; grad?: Gradient | null; tile?: string | null; tileScale?: number }
export interface LibTone { id: string; name: string; group: string; spec: ToneSpec }

export const SHAPES: [ToneShape, string][] = [["round", "Round dots"], ["square", "Square dots"], ["line", "Lines"], ["cross", "Crosshatch"],
  ["noise", "Sand"], ["cloud", "Clouds"], ["sparkle", "Sparkle"], ["stars", "Night sky"], ["flat", "Flat grey"], ["tile", "Image tile"]];

/* the page's print resolution (a v1 1800 px page is 182 mm wide, about 251 dpi) */
export const pageDpi = (doc: { width?: number; format?: { dpi?: number } } | null): number => doc?.format?.dpi || (doc?.width || 1800) / 182 * 25.4;

/* -------- coverage */
export function gradT(g: Gradient, x: number, y: number, w: number, h: number): number {
  const ax = g.a[0] * w, ay = g.a[1] * h, bx = g.b[0] * w, by = g.b[1] * h, dx = bx - ax, dy = by - ay;
  if (g.kind === "radial") return clamp(Math.hypot(x - ax, y - ay) / (Math.hypot(dx, dy) || 1), 0, 1);
  return clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
}
export function stopsAt(stops: Stop[], t: number): number {
  const s = [...stops].sort((p, q) => p[0] - q[0]);
  if (!s.length) return 0;
  if (t <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) if (t <= s[i][0]) return lerp(s[i - 1][1], s[i][1], (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0] || 1));
  return s[s.length - 1][1];
}
export function coverage(spec: ToneSpec, w: number, h: number): (x: number, y: number) => number {
  const g = spec.grad;
  if (!g || !g.stops?.length) { const c = clamp(spec.pct / 100, 0, 1); return () => c; }
  return (x, y) => clamp(stopsAt(g.stops, gradT(g, x, y, w, h)) / 100, 0, 1);
}

/* radius (in cells) of a round dot that covers `cov` of its cell; past 50% neighbouring dots merge
   into the chequerboard and then white holes, like a real AM screen */
const ROUND = (() => {
  const area = (q: number) => q <= 0.5 ? Math.PI * q * q : Math.PI * q * q - 4 * (q * q * Math.acos(0.5 / q) - 0.5 * Math.sqrt(q * q - 0.25));
  const N = 512, out = new Float32Array(N + 1);
  let q = 0;
  for (let i = 0; i <= N; i++) { const c = i / N; while (q < Math.SQRT1_2 && area(q) < c) q += 0.0005; out[i] = Math.min(q, Math.SQRT1_2); }
  return out;
})();
const roundR = (cov: number) => ROUND[Math.round(clamp(cov, 0, 1) * 512)];

/* -------- painting. g is drawn in the box's own pixels times s (device px per page px). */
export interface ToneEnv { dpi: number; seed: number; color: string; tileImg?: CanvasImageSource | null; tileW?: number }
export const FLAT_BELOW = 3;          // device px per cell under which a tone is shown as its average grey

export function paintTone(g: CanvasRenderingContext2D, spec: ToneSpec, w: number, h: number, s: number, env: ToneEnv) {
  const cov = coverage(spec, w, h), cell = env.dpi / Math.max(5, spec.lpi || 60);
  g.save(); g.scale(s, s);
  g.fillStyle = env.color; g.strokeStyle = env.color;
  const shape = spec.shape;
  const tiny = cell * s < FLAT_BELOW;
  if (shape === "flat" || (tiny && !["tile", "sparkle", "stars"].includes(shape))) { flat(g, spec, w, h); g.restore(); return; }
  const a = (spec.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), r = rng(env.seed);
  const lattice = (fn: (x: number, y: number, c: number) => void, step = cell) => {
    const R = Math.ceil(Math.hypot(w, h) / 2 / step) + 1;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const lx = i * step, ly = j * step, x = w / 2 + lx * ca - ly * sa, y = h / 2 + lx * sa + ly * ca;
      if (x < -step || y < -step || x > w + step || y > h + step) continue;
      fn(x, y, cov(x, y));
    }
  };
  if (shape === "stars" && tiny) flat(g, spec, w, h);
  if (shape === "round" || shape === "cloud" || (shape === "stars" && !tiny)) {
    const nz = shape === "cloud" ? noise2(env.seed) : null, k = 1 / (cell * 9);
    g.beginPath();
    lattice((x, y, c) => {
      if (nz) c = clamp(c * (nz(x * k, y * k) * 1.6 - 0.15) + (nz(x * k * 3 + 40, y * k * 3) - 0.5) * 0.12, 0, 1);
      if (c < 0.01) return;
      const rr = roundR(c) * cell; g.moveTo(x + rr, y); g.arc(x, y, rr, 0, Math.PI * 2);
    });
    g.fill();
  } else if (shape === "square") {
    g.beginPath();
    lattice((x, y, c) => {
      if (c < 0.01) return;
      const hs = Math.sqrt(c) * cell / 2, P = (u: number, v: number): Pt => [x + u * ca - v * sa, y + u * sa + v * ca];
      const q = [P(-hs, -hs), P(hs, -hs), P(hs, hs), P(-hs, hs)];
      g.moveTo(...q[0]); g.lineTo(...q[1]); g.lineTo(...q[2]); g.lineTo(...q[3]); g.closePath();
    });
    g.fill();
  } else if (shape === "line" || shape === "cross") {
    const bar = (x: number, y: number, t: number, rot: number) => {
      const c2 = Math.cos(a + rot), s2 = Math.sin(a + rot), u = cell / 2 + 0.6, v = t / 2;
      const P = (p: number, q: number): Pt => [x + p * c2 - q * s2, y + p * s2 + q * c2];
      const q = [P(-u, -v), P(u, -v), P(u, v), P(-u, v)];
      g.moveTo(...q[0]); g.lineTo(...q[1]); g.lineTo(...q[2]); g.lineTo(...q[3]); g.closePath();
    };
    g.beginPath();
    lattice((x, y, c) => {
      if (c < 0.01) return;
      if (shape === "line") return bar(x, y, c * cell, 0);
      const t = (1 - Math.sqrt(1 - c)) * cell; bar(x, y, t, 0); bar(x, y, t, Math.PI / 2);
    });
    g.fill("nonzero");
  } else if (shape === "noise") {
    const n = Math.round(w * h / (cell * cell) * 3);
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, c = cov(x, y), rr = cell * (0.22 + r() * 0.18);
      if (r() > c * 1.15) continue;
      g.moveTo(x + rr, y); g.arc(x, y, rr, 0, Math.PI * 2);
    }
    g.fill();
  }
  if (shape === "sparkle" || shape === "stars") {
    if (shape === "stars") g.globalCompositeOperation = "destination-out";
    const n = Math.round(w * h / (cell * cell) / 40);
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, c = shape === "stars" ? 1 : cov(x, y);
      if (r() > c) continue;
      const big = r() < 0.08, len = cell * (big ? 4 + r() * 6 : 0.8 + r() * 1.6);
      if (big || r() < 0.5) star(g, x, y, len, len * 0.16);
      else { g.beginPath(); g.arc(x, y, len * 0.3, 0, Math.PI * 2); g.fill(); }
    }
  } else if (shape === "tile") {
    const im = env.tileImg;
    if (im && env.tileW) {
      const pat = g.createPattern(im, "repeat");
      if (pat) {
        const k = (spec.tileScale || 1);
        pat.setTransform(new DOMMatrix().translateSelf(w / 2, h / 2).rotateSelf(spec.angle || 0).scaleSelf(k, k));
        g.fillStyle = pat; g.globalAlpha = clamp(spec.pct / 100, 0, 1) || 1; g.fillRect(0, 0, w, h);
      }
    }
  }
  g.restore();
}
function flat(g: CanvasRenderingContext2D, spec: ToneSpec, w: number, h: number) {
  const gr = spec.grad;
  if (!gr || !gr.stops?.length) { g.globalAlpha = clamp(spec.pct / 100, 0, 1); g.fillRect(0, 0, w, h); g.globalAlpha = 1; return; }
  const ax = gr.a[0] * w, ay = gr.a[1] * h, bx = gr.b[0] * w, by = gr.b[1] * h;
  const cg = gr.kind === "radial" ? g.createRadialGradient(ax, ay, 0, ax, ay, Math.hypot(bx - ax, by - ay) || 1) : g.createLinearGradient(ax, ay, bx, by);
  const col = String(g.fillStyle);
  for (const [t, p] of [...gr.stops].sort((u, v) => u[0] - v[0])) cg.addColorStop(clamp(t, 0, 1), withAlpha(col, clamp(p / 100, 0, 1)));
  const keep = g.fillStyle; g.fillStyle = cg; g.fillRect(0, 0, w, h); g.fillStyle = keep;
}
function star(g: CanvasRenderingContext2D, x: number, y: number, len: number, wd: number) {
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, rr = k % 2 ? wd : len;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    k ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath(); g.fill();
}
export function withAlpha(col: string, a: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(col);
  if (!m) return `rgba(0,0,0,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

/* -------- the built-in library */
const lin = (from: number, to: number, a: Pt = [0.5, 0.04], b: Pt = [0.5, 0.96]): Gradient => ({ kind: "linear", a, b, stops: [[0, from], [1, to]] });
export const BUILTIN: LibTone[] = (() => {
  const out: LibTone[] = [];
  const add = (group: string, name: string, spec: ToneSpec) => out.push({ id: `${group}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, group, spec });
  for (const lpi of [50, 60, 65]) for (const pct of [10, 20, 30, 40, 50, 60]) add("Dots", `${lpi} L ${pct}%`, { shape: "round", lpi, pct, angle: 45 });
  for (const pct of [10, 20, 30, 40]) add("Fine dots", `85 L ${pct}%`, { shape: "round", lpi: 85, pct, angle: 45 });
  for (const pct of [10, 20, 30, 40, 50, 60]) add("Square dots", `55 L ${pct}%`, { shape: "square", lpi: 55, pct, angle: 45 });
  for (const [lpi, pct, ang] of [[40, 20, 0], [40, 35, 0], [50, 20, 90], [50, 30, 45], [60, 25, 135], [32, 40, 0]] as const)
    add("Lines", `${lpi} L ${pct}% ${ang}°`, { shape: "line", lpi, pct, angle: ang });
  for (const [lpi, pct] of [[40, 20], [40, 35], [50, 25], [60, 45], [65, 30]] as const) add("Crosshatch", `${lpi} L ${pct}%`, { shape: "cross", lpi, pct, angle: 45 });
  for (const pct of [15, 30, 50]) add("Sand", `Sand ${pct}%`, { shape: "noise", lpi: 85, pct, angle: 0 });
  for (const pct of [20, 35, 55]) add("Clouds", `Clouds ${pct}%`, { shape: "cloud", lpi: 55, pct, angle: 45 });
  add("Effects", "Sparkle", { shape: "sparkle", lpi: 50, pct: 70, angle: 0 });
  add("Effects", "Sparkle fade", { shape: "sparkle", lpi: 50, pct: 70, angle: 0, grad: lin(90, 0) });
  add("Effects", "Night sky", { shape: "stars", lpi: 40, pct: 85, angle: 0 });
  add("Effects", "Night sky fade", { shape: "stars", lpi: 40, pct: 85, angle: 0, grad: lin(95, 30) });
  for (const pct of [10, 25, 50, 75]) add("Flat", `Grey ${pct}%`, { shape: "flat", lpi: 60, pct, angle: 0 });
  add("Gradients", "Fade down", { shape: "round", lpi: 55, pct: 60, angle: 45, grad: lin(70, 0) });
  add("Gradients", "Fade up", { shape: "round", lpi: 55, pct: 60, angle: 45, grad: lin(0, 70) });
  add("Gradients", "Fade right", { shape: "round", lpi: 55, pct: 60, angle: 45, grad: lin(70, 0, [0.04, 0.5], [0.96, 0.5]) });
  add("Gradients", "Vignette", { shape: "round", lpi: 55, pct: 60, angle: 45, grad: { kind: "radial", a: [0.5, 0.5], b: [1, 1], stops: [[0, 0], [0.45, 0], [1, 80]] } });
  add("Gradients", "Spotlight", { shape: "round", lpi: 55, pct: 60, angle: 45, grad: { kind: "radial", a: [0.5, 0.5], b: [1, 1], stops: [[0, 80], [1, 0]] } });
  add("Gradients", "Dark band", { shape: "round", lpi: 55, pct: 60, angle: 45, grad: { kind: "linear", a: [0.5, 0.04], b: [0.5, 0.96], stops: [[0, 0], [0.5, 70], [1, 0]] } });
  add("Gradients", "Line fade", { shape: "line", lpi: 45, pct: 40, angle: 0, grad: lin(55, 0) });
  return out;
})();

/* user tones live in this browser until the asset library takes them over */
const KEY = "mm.tones.user";
export function userTones(): LibTone[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveUserTone(name: string, spec: ToneSpec): LibTone {
  const t: LibTone = { id: "user-" + Date.now().toString(36), name, group: "Mine", spec: JSON.parse(JSON.stringify(spec)) };
  try { localStorage.setItem(KEY, JSON.stringify([...userTones(), t])); } catch { }
  return t;
}
export function removeUserTone(id: string) {
  try { localStorage.setItem(KEY, JSON.stringify(userTones().filter(t => t.id !== id))); } catch { }
}
export const allTones = (): LibTone[] => [...BUILTIN, ...userTones()];
export const toneById = (id: string): LibTone | undefined => allTones().find(t => t.id === id);

export const specOf = (l: Record<string, any>): ToneSpec => ({ shape: l.shape, lpi: l.lpi, pct: l.pct, angle: l.angle, grad: l.grad || null, tile: l.tile || null, tileScale: l.tileScale || 1 });

/* the v1 tone fields (pattern, cell size in px, density, fade) as a v2 spec */
export function migrateTone(l: Record<string, any>, dpi: number) {
  if (l.shape) return;
  const shape: ToneShape = ({ dots: "round", lines: "line", cross: "cross", noise: "noise", solid: "flat" } as Record<string, ToneShape>)[l.pattern] || "round";
  const pct = Math.round((l.density ?? 0.35) * 100);
  const F: Record<string, Gradient> = {
    down: lin(pct, 0), up: lin(0, pct), right: lin(pct, 0, [0.04, 0.5], [0.96, 0.5]), left: lin(0, pct, [0.04, 0.5], [0.96, 0.5]),
    edges: { kind: "radial", a: [0.5, 0.5], b: [1, 1], stops: [[0, 0], [1 / 1.2, pct], [1, pct]] },
    center: { kind: "radial", a: [0.5, 0.5], b: [1, 1], stops: [[0, pct], [1 / 1.2, 0], [1, 0]] },
  };
  Object.assign(l, { shape, lpi: Math.round(dpi / Math.max(2, l.size ?? 12) * 10) / 10, pct, grad: F[l.fade] || null });
  for (const k of ["pattern", "size", "density", "fade"]) delete l[k];
}
