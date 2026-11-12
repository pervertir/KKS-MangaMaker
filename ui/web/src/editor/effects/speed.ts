/* Speed and focus lines as tapered vector wedges, so they stay sharp at any export size.
   Modes: focus (集中線, wedges from outside toward an empty centre), parallel (流線), beta flash (ベタフラ,
   solid black pierced by white spikes around the centre) and uni flash (ウニフラ, outlined spikes bursting
   out of the centre). The centre and the "no line" shape are editable; a seed keeps lines stable. */
import { clamp, rayExit, rng, type Pt } from "./geom.ts";

export type SpeedMode = "focus" | "parallel" | "beta" | "uni";
export const MODES: [SpeedMode, string][] = [["focus", "Focus lines (集中線)"], ["parallel", "Speed lines (流線)"], ["beta", "Beta flash (ベタフラ)"], ["uni", "Uni flash (ウニフラ)"]];

export interface SpeedSpec {
  mode: SpeedMode; count: number; thick: number; inner: number; jitter: number; spread: number; taper: number; angle: number;
  center: Pt; innerPts?: Pt[] | null; seed: number; outline?: number; fill?: string | null;
}

/* distance from the centre to the "no line" boundary along angle a, in box px */
export function boundaryAt(sp: SpeedSpec, w: number, h: number, a: number): number {
  const c: Pt = [sp.center[0] * w, sp.center[1] * h];
  if (sp.innerPts?.length && sp.innerPts.length > 2) {
    const poly = sp.innerPts.map(([x, y]): Pt => [x * w, y * h]);
    return rayExit(c, a, poly) ?? 0;
  }
  const rx = Math.max(1, sp.inner * w / 2), ry = Math.max(1, sp.inner * h / 2), ca = Math.cos(a), sa = Math.sin(a);
  return 1 / Math.sqrt((ca / rx) ** 2 + (sa / ry) ** 2);
}
/* the default "no line" ellipse as an editable polygon */
export function innerPolygon(sp: SpeedSpec, n = 12): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2;
    out.push([sp.center[0] + Math.cos(a) * sp.inner / 2, sp.center[1] + Math.sin(a) * sp.inner / 2]);
  }
  return out;
}

function angles(sp: SpeedSpec, r: () => number): number[] {
  const n = Math.max(1, Math.round(sp.count)), out: number[] = [];
  for (let k = 0; k < n; k++) {
    const even = (k + 0.5) / n * Math.PI * 2 + (r() - 0.5) * Math.PI * 2 / n * Math.min(1, sp.spread * 2);
    out.push(sp.spread > 0.5 && r() < (sp.spread - 0.5) * 2 ? r() * Math.PI * 2 : even);
  }
  return out;
}
/* a wedge from (x0, y0) with half-width t0 to (x1, y1) with half-width t1 */
function wedge(P: Path2D, x0: number, y0: number, t0: number, x1: number, y1: number, t1: number) {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
  P.moveTo(x0 + nx * t0, y0 + ny * t0);
  if (t1 > 0.01) { P.lineTo(x1 + nx * t1, y1 + ny * t1); P.lineTo(x1 - nx * t1, y1 - ny * t1); } else P.lineTo(x1, y1);
  P.lineTo(x0 - nx * t0, y0 - ny * t0); P.closePath();
}
/* a spike that swells out of the base then narrows to a point (uni flash) */
function spindle(P: Path2D, x0: number, y0: number, x1: number, y1: number, t: number) {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L, mx = x0 + (x1 - x0) * 0.25, my = y0 + (y1 - y0) * 0.25;
  P.moveTo(x0, y0); P.lineTo(mx + nx * t, my + ny * t); P.lineTo(x1, y1); P.lineTo(mx - nx * t, my - ny * t); P.closePath();
}

export function paintSpeed(g: CanvasRenderingContext2D, sp: SpeedSpec, w: number, h: number, s: number, color: string) {
  const r = rng(sp.seed), cx = sp.center[0] * w, cy = sp.center[1] * h;
  const far = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy)) + 4;
  const taper = clamp(sp.taper ?? 1, 0, 1);
  g.save(); g.scale(s, s); g.fillStyle = color;
  if (sp.mode === "parallel") {
    const P = new Path2D(), a = (sp.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), D = Math.hypot(w, h) / 2;
    const n = Math.max(1, Math.round(sp.count));
    for (let k = 0; k < n; k++) {
      const even = ((k + 0.5) / n * 2 - 1) * D, y = even + (r() - 0.5) * (2 * D / n) * sp.spread * 4;
      const len = D * (0.4 + r() * 1.2) * (1 - sp.inner * 0.6) * (1 + (r() - 0.5) * sp.jitter);
      const x1 = (r() * 2 - 1) * D * (0.3 + sp.jitter), x0 = x1 - len, t = sp.thick * (0.15 + r() * 0.6) / 2;
      const L = (u: number, v: number): [number, number] => [w / 2 + u * ca - v * sa, h / 2 + u * sa + v * ca];
      const [ax, ay] = L(x0, y), [bx, by] = L(x1, y);
      wedge(P, bx, by, t, ax, ay, t * (1 - taper));
    }
    g.fill(P); g.restore(); return;
  }
  const as = angles(sp, r);
  if (sp.mode === "focus") {
    const P = new Path2D();
    for (const a of as) {
      const ca = Math.cos(a), sa = Math.sin(a), b = boundaryAt(sp, w, h, a);
      const reach = b * (1 + sp.jitter * (r() * 1.6 - 0.3)), t = sp.thick * (0.35 + r() * 0.9) / 2;
      wedge(P, cx + ca * far, cy + sa * far, t, cx + ca * reach, cy + sa * reach, t * (1 - taper));
    }
    g.fill(P);
  } else if (sp.mode === "beta") {
    const P = new Path2D();
    P.rect(0, 0, w, h);
    const ring: Pt[] = [];                                // the white burst: valleys at the boundary, spikes beyond it
    as.sort((p, q) => p - q).forEach(a => {
      const b = boundaryAt(sp, w, h, a), half = Math.PI / as.length * (0.3 + 0.5 * (1 - taper));
      const tip = b * (1.25 + r() * (0.6 + sp.jitter * 2.2)), vb = b * (0.98 + r() * 0.04);
      ring.push([cx + Math.cos(a - half) * vb, cy + Math.sin(a - half) * vb], [cx + Math.cos(a) * tip, cy + Math.sin(a) * tip],
        [cx + Math.cos(a + half) * vb, cy + Math.sin(a + half) * vb]);
    });
    ring.forEach(([x, y], i) => i ? P.lineTo(x, y) : P.moveTo(x, y)); P.closePath();
    g.fill(P, "evenodd");
    if (sp.fill) { g.fillStyle = sp.fill; const W = new Path2D(); ring.forEach(([x, y], i) => i ? W.lineTo(x, y) : W.moveTo(x, y)); W.closePath(); g.fill(W); }
  } else {
    const ol = sp.outline ?? 3;
    if (sp.fill) { g.fillStyle = sp.fill; const W = new Path2D(); for (let k = 0; k < 72; k++) { const a = k / 72 * Math.PI * 2, b = boundaryAt(sp, w, h, a); k ? W.lineTo(cx + Math.cos(a) * b, cy + Math.sin(a) * b) : W.moveTo(cx + Math.cos(a) * b, cy + Math.sin(a) * b); } W.closePath(); g.fill(W); }
    for (const a of as) {
      const ca = Math.cos(a), sa = Math.sin(a), b = boundaryAt(sp, w, h, a);
      const start = b * (0.85 + r() * 0.2), len = Math.max(8, (far - b) * (0.25 + r() * (0.35 + sp.jitter * 0.6)));
      const P = new Path2D(), t = sp.thick * (0.4 + r() * 0.8) / 2 * (0.4 + 0.6 * taper);
      spindle(P, cx + ca * start, cy + sa * start, cx + ca * (start + len), cy + sa * (start + len), t);
      if (ol > 0) { g.lineJoin = "round"; g.lineWidth = ol * 2; g.strokeStyle = "#ffffff"; g.stroke(P); }
      g.fillStyle = color; g.fill(P);
    }
  }
  g.restore();
}

export const SPEED_DEFAULTS: Record<string, Record<string, any>> = {
  focus: { count: 160, thick: 14, inner: 0.45, jitter: 0.35, spread: 0.6, taper: 1 },
  parallel: { count: 120, thick: 10, inner: 0.2, jitter: 0.5, spread: 0.6, taper: 1 },
  beta: { count: 70, thick: 10, inner: 0.35, jitter: 0.45, spread: 0.5, taper: 0.6, fill: null },
  uni: { count: 90, thick: 18, inner: 0.3, jitter: 0.5, spread: 0.7, taper: 1, outline: 3, fill: null },
};

/* the v1 speed fields as v2 */
export function migrateSpeed(l: Record<string, any>) {
  l.mode ||= "focus";
  const d = SPEED_DEFAULTS[l.mode] || SPEED_DEFAULTS.focus;
  for (const k of Object.keys(d)) if (l[k] === undefined) l[k] = d[k];
  l.angle ??= 0; l.center ||= [0.5, 0.5]; l.innerPts ??= null;
}
