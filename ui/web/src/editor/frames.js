
import { clamp, deep } from "./core.js";
import { rng } from "./manga-tools.js";
import { provideOutline } from "../core/registry.ts";
/* Panel frame shapes. A panel keeps its bounding box (x, y, w, h) for layout, snapping and reading order;
   its outline comes from:
     shape   "rect" (default) | "poly" (pts: [[u, v], ...] as fractions of the box) | "ellipse"
     radius  rounded corners of a rect, px
     edge    "solid" | "dashed" (memory) | "wavy" (dream, flashback) | "jagged" (shock, scream)
     gap     a paper-coloured band outside the border, for insets laid over another panel
   Everything that touches a panel's area (fill, render clip, border, hit test, tone clip, export) goes
   through panelOutline, so a shape looks and behaves the same in the editor, thumbnails and exports. */
"use strict";

export const FRAME_SHAPES = [
  ["rect", "Rectangle", { shape: "rect", radius: 0 }],
  ["rounded", "Rounded corners (memory, calm)", { shape: "rect", radius: 48 }],
  ["slant", "Slanted (motion, tension)", { shape: "poly", pts: [[0.14, 0], [1, 0], [0.86, 1], [0, 1]] }],
  ["trapezoid", "Trapezoid (perspective, impact)", { shape: "poly", pts: [[0.1, 0], [0.9, 0], [1, 1], [0, 1]] }],
  ["wedge", "Diagonal top (a slanted gutter)", { shape: "poly", pts: [[0, 0.2], [1, 0], [1, 1], [0, 1]] }],
  ["cut", "Cut corner", { shape: "poly", pts: [[0, 0], [0.78, 0], [1, 0.24], [1, 1], [0, 1]] }],
  ["shard", "Shard (broken, chaotic)", { shape: "poly", pts: [[0.08, 0], [1, 0.12], [0.84, 1], [0, 0.82]] }],
  ["ellipse", "Circle / oval (close-up, inset)", { shape: "ellipse" }],
];
export const FRAME_EDGES = [["solid", "Line"], ["dashed", "Dashed (memory)"], ["wavy", "Wavy (dream, flashback)"], ["jagged", "Jagged (shock)"]];

/* ---------------------------------------------------------------- geometry */
export function polyArea(P) { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
export function polyBox(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function pointInPoly(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/* the part of P on the side n·p >= k (Sutherland–Hodgman against one line) */
export function clipHalf(P, nx, ny, k) {
  const out = [], f = p => p.x * nx + p.y * ny - k;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return dedupe(out);
}
export function dedupe(P) {
  const out = [];
  for (const p of P) { const q = out[out.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.5) out.push(p); }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 0.5) out.pop();
  return out;
}
export const isAxisRect = P => P.length === 4 && P.every((p, i) => { const q = P[(i + 1) % 4]; return Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5; });

/* the panel's corners before any edge effect, in page px */
export function panelBase(l) {
  const { x, y, w, h } = l;
  if (l.shape === "poly" && l.pts?.length >= 3) return l.pts.map(([u, v]) => ({ x: x + u * w, y: y + v * h }));
  if (l.shape === "ellipse") {
    const n = 96, out = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 - Math.PI / 2; out.push({ x: x + w / 2 + Math.cos(a) * w / 2, y: y + h / 2 + Math.sin(a) * h / 2 }); }
    return out;
  }
  const r = Math.min(l.radius || 0, w / 2, h / 2);
  if (r < 1) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const out = [], seg = 10;
  for (const [cx, cy, a0] of [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]])
    for (let i = 0; i <= seg; i++) { const a = (a0 + i / seg * 90) * Math.PI / 180; out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  return out;
}
export const isSmooth = l => l.shape === "ellipse" || (l.shape !== "poly" && (l.radius || 0) >= 1);

/* wavy / jagged: the base outline displaced along its outward normal. Straight shapes get a whole number of
   waves per edge so corners stay sharp; smooth ones get them over the whole perimeter. */
export function edgeOutline(l, base) {
  const edge = l.edge;
  if (edge !== "wavy" && edge !== "jagged") return base;
  const out = [], sgn = polyArea(base) >= 0 ? 1 : -1, r = rng((l.seed ?? 1) + 7);
  const amp = edge === "wavy" ? clamp(Math.min(l.w, l.h) * 0.02, 5, 12) : clamp(Math.min(l.w, l.h) * 0.035, 8, 26);
  const lam = edge === "wavy" ? 90 : 46;
  const disp = t => edge === "wavy" ? Math.sin(t * Math.PI * 2) * amp : 0;
  if (isSmooth(l)) {
    const n = base.length, len = [];
    let tot = 0;
    for (let i = 0; i < n; i++) { const p = base[i], q = base[(i + 1) % n]; len.push(tot); tot += Math.hypot(q.x - p.x, q.y - p.y); }
    const waves = Math.max(3, Math.round(tot / lam));
    const nrm = i => { const a = base[(i - 1 + n) % n], b = base[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; return [sgn * dy / d, -sgn * dx / d]; };
    // resample so each wave has enough points whatever the base spacing
    const steps = waves * (edge === "wavy" ? 10 : 2);
    let j = 0;
    for (let s = 0; s < steps; s++) {
      const at = s / steps * tot;
      while (j < n - 1 && len[j + 1] <= at) j++;
      const p = base[j], q = base[(j + 1) % n], seg = (j + 1 < n ? len[j + 1] : tot) - len[j] || 1, t = (at - len[j]) / seg;
      const [nx0, ny0] = nrm(j), [nx1, ny1] = nrm((j + 1) % n), nx = nx0 + (nx1 - nx0) * t, ny = ny0 + (ny1 - ny0) * t;
      const d = edge === "wavy" ? disp(s / steps * waves) : (s % 2 ? -amp * (0.6 + r() * 0.8) : 0);   // spikes point in: the frame stays inside its box
      out.push({ x: p.x + (q.x - p.x) * t + nx * d, y: p.y + (q.y - p.y) * t + ny * d });
    }
    return out;
  }
  for (let i = 0; i < base.length; i++) {
    const p = base[i], q = base[(i + 1) % base.length], L = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = sgn * (q.y - p.y) / L, ny = -sgn * (q.x - p.x) / L;
    const k = Math.max(1, Math.round(L / lam)), sub = edge === "wavy" ? k * 10 : k * 2;
    for (let s = 0; s < sub; s++) {
      const t = s / sub, d = s === 0 ? 0 : edge === "wavy" ? disp(t * k) : (s % 2 ? -amp * (0.6 + r() * 0.8) : 0);
      out.push({ x: p.x + (q.x - p.x) * t + nx * d, y: p.y + (q.y - p.y) * t + ny * d });
    }
  }
  return out;
}
export const OUTLINES = new Map();
export function panelOutline(l) {
  const key = [l.shape, l.x, l.y, l.w, l.h, l.radius, l.edge, l.seed, l.shape === "poly" ? JSON.stringify(l.pts) : ""].join("|");
  let P = OUTLINES.get(key);
  if (!P) {
    P = edgeOutline(l, panelBase(l));
    if (OUTLINES.size > 400) OUTLINES.delete(OUTLINES.keys().next().value);
    OUTLINES.set(key, P);
  }
  return P;
}
export const isPlainRect = l => (!l.shape || l.shape === "rect") && !(l.radius >= 1) && l.edge !== "wavy" && l.edge !== "jagged";
export function tracePanel(ctx, l) {
  if (isPlainRect(l)) { ctx.rect(l.x, l.y, l.w, l.h); return; }
  const P = panelOutline(l);
  ctx.moveTo(P[0].x, P[0].y);
  for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
  ctx.closePath();
}
export function clipToPanel(ctx, l) { ctx.beginPath(); tracePanel(ctx, l); ctx.clip(); }
export function panelHit(l, x, y) {
  if (x < l.x - 30 || y < l.y - 30 || x > l.x + l.w + 30 || y > l.y + l.h + 30) return false;
  return isPlainRect(l) ? (x >= l.x && y >= l.y && x <= l.x + l.w && y <= l.y + l.h) : pointInPoly(panelOutline(l), x, y);
}
/* border drawn outside the outline (like the rectangular frames always were), plus the optional gap band */
export function strokePanel(ctx, l, paper) {
  const b = l.border || 0, g = l.gap || 0;
  if (b <= 0 && g <= 0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(l.x - 1e4, l.y - 1e4, l.w + 2e4, l.h + 2e4); tracePanel(ctx, l); ctx.clip("evenodd");
  ctx.beginPath(); tracePanel(ctx, l);
  ctx.lineJoin = l.edge === "wavy" || isSmooth(l) ? "round" : "miter"; ctx.miterLimit = 6;
  if (g > 0) { ctx.strokeStyle = paper || "#fff"; ctx.lineWidth = (b + g) * 2; ctx.stroke(); }
  if (b > 0) {
    ctx.strokeStyle = l.borderColor || "#000"; ctx.lineWidth = b * 2;
    if (l.edge === "dashed") { ctx.setLineDash([b * 5, b * 3.5]); ctx.lineCap = "butt"; }
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- editing */
/* a panel whose outline is these page-px corners */
export function setPanelPoly(l, P, keepPoly) {
  const B = polyBox(P);
  l.x = B.x; l.y = B.y; l.w = Math.max(1, B.w); l.h = Math.max(1, B.h);
  if (!keepPoly && isAxisRect(P)) { l.shape = "rect"; delete l.pts; return l; }
  l.shape = "poly"; l.radius = 0;
  l.pts = P.map(p => [+((p.x - l.x) / l.w).toFixed(5), +((p.y - l.y) / l.h).toFixed(5)]);
  return l;
}
export function applyFrameShape(l, key) {
  const s = FRAME_SHAPES.find(f => f[0] === key); if (!s) return;
  Object.assign(l, deep(s[2]));
  if (l.shape !== "poly") delete l.pts;
  if (l.shape !== "rect") l.radius = 0;
}
export function frameShapeKey(l) {
  if (l.shape === "ellipse") return "ellipse";
  if (l.shape !== "poly") return (l.radius || 0) >= 1 ? "rounded" : "rect";
  const s = FRAME_SHAPES.find(f => f[2].pts && JSON.stringify(f[2].pts) === JSON.stringify(l.pts));
  return s ? s[0] : "custom";
}
/* cut a panel in two along a line through its centre: dir "v" side by side, "h" top / bottom; tilt in degrees.
   Works on any outline (a slanted split of a circle gives two curved halves). Returns [first, second] outlines. */
export function splitOutline(l, dir, tilt, gutter) {
  const P = panelBase(l), cx = l.x + l.w / 2, cy = l.y + l.h / 2, a = tilt * Math.PI / 180;
  const nx = dir === "v" ? Math.cos(a) : Math.sin(a), ny = dir === "v" ? Math.sin(a) : -Math.cos(a);   // normal of the cut
  const k = nx * cx + ny * cy, g = gutter / 2;
  const A = clipHalf(P, -nx, -ny, -k + g), B = clipHalf(P, nx, ny, k + g);       // the two sides of the gutter
  return dir === "v" ? [A, B] : [B, A];
}
/* full-bleed: corners within `near` px of a page edge move onto it (past the trim, the way printed bleeds run) */
export function bleedPanel(l, W, H, near = 140) {
  const P = (isPlainRect(l) || l.shape === "poly" ? panelBase(l) : null);
  if (!P) {                     // ellipse / rounded: stretch the box instead
    const x1 = l.x + l.w, y1 = l.y + l.h;
    if (l.x < near) l.x = 0; if (l.y < near) l.y = 0;
    l.w = (W - x1 < near ? W : x1) - l.x; l.h = (H - y1 < near ? H : y1) - l.y; return l;
  }
  for (const p of P) { if (p.x < near) p.x = 0; if (p.y < near) p.y = 0; if (W - p.x < near) p.x = W; if (H - p.y < near) p.y = H; }
  return setPanelPoly(l, P);
}

/* ---------------------------------------------------------------- shaped layouts */
/* A layout is a tree of straight cuts across the live area. A cut is [x0, y0, x1, y1] in page fractions,
   then what lies on its left/top and right/bottom side: another cut, null (a panel), or {props} for the panel. */
export function cutLayout(tree, W, H, margin = 60, gutter = 30, extra = []) {
  const out = [];
  const rec = (P, node) => {
    if (P.length < 3) return;
    if (!Array.isArray(node)) { out.push({ ...setPanelPoly({}, P), ...(node || {}) }); return; }
    const [x0, y0, x1, y1, a, b] = node, X0 = x0 * W, Y0 = y0 * H, X1 = x1 * W, Y1 = y1 * H;
    const dx = X1 - X0, dy = Y1 - Y0, d = Math.hypot(dx, dy);
    let nx = dy / d, ny = -dx / d;
    if (Math.abs(dy) > Math.abs(dx) ? nx > 0 : ny > 0) { nx = -nx; ny = -ny; }   // normal points left (steep cut) or up (level cut)
    const k = nx * X0 + ny * Y0;
    rec(clipHalf(P, nx, ny, k + gutter / 2), a);                  // left / top side
    rec(clipHalf(P, -nx, -ny, -k + gutter / 2), b);               // right / bottom side
  };
  rec([{ x: margin, y: margin }, { x: W - margin, y: margin }, { x: W - margin, y: H - margin }, { x: margin, y: H - margin }], tree);
  for (const e of extra) out.push(typeof e === "function" ? e(W, H) : e);
  return out;
}
export const SHAPED_LAYOUTS = [
  ["Slanted tiers", [0, 0.36, 1, 0.3, null, [0, 0.69, 1, 0.75, null, null]]],
  ["Action zigzag", [0, 0.34, 1, 0.3, [0.58, 0, 0.46, 0.34, null, null], [0, 0.7, 1, 0.64, null, [0.42, 0.6, 0.56, 1, null, null]]]],
  ["Diagonal duel", [0, 0.68, 1, 0.32, null, null]],
  ["Shattered", [0.56, 0, 0.4, 1, [0, 0.42, 0.5, 0.56, null, null], [0.45, 0.62, 1, 0.36, null, null]]],
  ["Perspective stack", [0, 0.28, 1, 0.36, null, [0, 0.66, 1, 0.58, [0.47, 0.3, 0.53, 0.7, null, null], null]]],
  ["Close-up inset", null, [(W, H) => ({ x: 120, y: H * 0.62, w: W * 0.36, h: W * 0.36, shape: "ellipse", gap: 16 })]],
  ["Dream sequence", [0, 0.34, 1, 0.34, { edge: "wavy", radius: 40, border: 4 }, [0, 0.67, 1, 0.67, { edge: "wavy", radius: 40, border: 4 }, null]]],
  ["Memory", [0, 0.5, 1, 0.5, [0.5, 0, 0.5, 0.5, { radius: 48, edge: "dashed", border: 4 }, { radius: 48, edge: "dashed", border: 4 }], { radius: 48 }]],
  ["Shock reveal", [0, 0.3, 1, 0.3, [0.5, 0, 0.5, 0.3, null, null], { edge: "jagged", seed: 5 }]],
  ["Bleed splash", [0, 0.7, 1, 0.7, { bleed: true, border: 0 }, [0.5, 0.7, 0.5, 1, null, null]]],
];
export function shapedLayout(i, W, H) {
  const [, tree, extra] = SHAPED_LAYOUTS[i];
  let out = cutLayout(tree, W, H, 60, 30, extra || []);
  for (const p of out) if (p.bleed) { delete p.bleed; bleedPanel(p, W, H); }
  return out;
}
/* layout entries are [x, y, w, h] rects (template packs, grids) or panel objects with a shape */
export const layoutEntry = e => Array.isArray(e) ? { x: e[0], y: e[1], w: e[2], h: e[3] } : e;
export function layoutThumb(entries, W, H, tw = 120) {
  const th = Math.round(tw * H / W), c = document.createElement("canvas"); c.width = tw; c.height = th;
  const g = c.getContext("2d"), s = tw / W;
  g.fillStyle = "#fff"; g.fillRect(0, 0, tw, th); g.setTransform(s, 0, 0, s, 0, 0);
  for (const e of entries.map(layoutEntry)) {
    const l = { border: 6, ...e, borderColor: "#111", fill: "#fff" };
    g.fillStyle = "#e9e9ee"; g.beginPath(); tracePanel(g, l); g.fill();
    strokePanel(g, { ...l, border: Math.max(l.border ? 9 : 0, (l.border || 0) * 1.5) }, "#fff");
  }
  return c;
}

/* shaped panels give the core their real outline, so clipping, hit tests and selections follow the shape */
provideOutline(l => l.type === "panel" && !isPlainRect(l) ? [panelOutline(l).map(p => [p.x, p.y])] : null);
