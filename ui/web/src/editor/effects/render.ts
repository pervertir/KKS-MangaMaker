/* Draws a tone or speed-lines layer: the pattern is generated into a bitmap at the target scale, cut to the
   layer's region and eraser strokes, cached per (settings, size, scale), and blitted in the layer's box.
   `region` is in page px as it was when set, together with the box it was set on (`regionAt`); moving or
   resizing the layer carries the region along. */
import { S } from "../state.ts";
import { imgFor } from "../images.js";
import { toFrac, type Box, type Pt } from "./geom.ts";
import type { Region } from "../../core/geometry/region.ts";
import { pageDpi, paintTone, specOf } from "./tones.ts";
import { paintSpeed, type SpeedSpec } from "./speed.ts";

type L = Record<string, any>;
const CACHE = new Map<string, HTMLCanvasElement>();
const LAST = new Map<string, HTMLCanvasElement>();
const MAX_PX = 4096;

export interface EraseStroke { r: number; pts: Pt[] }

function scaleFor(l: L, rs: number): number {
  const q = 2 ** Math.round(Math.log2(Math.max(rs, 1 / 64)));
  return Math.min(q, MAX_PX / Math.max(l.w, l.h, 1));
}
const FIELDS: Record<string, string[]> = {
  tone: ["shape", "lpi", "pct", "angle", "grad", "tile", "tileScale", "seed"],
  speed: ["mode", "count", "thick", "inner", "jitter", "spread", "taper", "angle", "center", "innerPts", "seed", "outline", "fill"],
};

export function effectArt(l: L, rs: number): HTMLCanvasElement {
  const s = scaleFor(l, rs), tileImg = l.type === "tone" && l.shape === "tile" && l.tile ? imgFor(l.tile, 512) : null;
  const key = [l.type, l.color, Math.round(l.w), Math.round(l.h), s, tileImg ? 1 : 0,
    JSON.stringify(FIELDS[l.type].map(k => l[k])), JSON.stringify(l.region || null), JSON.stringify(l.regionAt || null), JSON.stringify(l.erase || null)].join("|");
  const live = S.drag?.layer?.id === l.id && !S.drag.fx && LAST.get(l.id);
  if (live && !CACHE.has(key)) return live;
  let c = CACHE.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(l.w * s)); c.height = Math.max(1, Math.round(l.h * s));
    const g = c.getContext("2d")!;
    if (l.type === "tone") paintTone(g, specOf(l), l.w, l.h, s, { dpi: pageDpi(S.doc), seed: l.seed || 1, color: l.color, tileImg, tileW: tileImg ? (tileImg as HTMLImageElement).naturalWidth : 0 });
    else paintSpeed(g, l as unknown as SpeedSpec, l.w, l.h, s, l.color);
    cutTo(g, l, c.width, c.height);
    if (CACHE.size > 48) CACHE.delete(CACHE.keys().next().value!);
    CACHE.set(key, c);
  }
  LAST.set(l.id, c);
  return c;
}

/* keep only the region, then take out the eraser strokes */
function cutTo(g: CanvasRenderingContext2D, l: L, cw: number, ch: number) {
  const reg = l.region as Region | null;
  if (reg?.length) {
    const at: Box = l.regionAt || l, P = new Path2D();
    for (const ring of reg) {
      ring.forEach((p, i) => { const [fx, fy] = toFrac(at, p), x = fx * cw, y = fy * ch; i ? P.lineTo(x, y) : P.moveTo(x, y); });
      P.closePath();
    }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "destination-in"; g.fillStyle = "#000"; g.fill(P, "evenodd"); g.restore();
  }
  const er = l.erase as EraseStroke[] | null;
  if (er?.length) {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "destination-out";
    g.lineCap = g.lineJoin = "round"; g.strokeStyle = "#000"; g.fillStyle = "#000";
    const k = cw / l.w;
    for (const st of er) {
      g.lineWidth = st.r * 2 * k;
      if (st.pts.length === 1) { g.beginPath(); g.arc(st.pts[0][0] * cw, st.pts[0][1] * ch, st.r * k, 0, Math.PI * 2); g.fill(); continue; }
      g.beginPath(); st.pts.forEach(([x, y], i) => i ? g.lineTo(x * cw, y * ch) : g.moveTo(x * cw, y * ch)); g.stroke();
    }
    g.restore();
  }
}

export function drawEffect(ctx: CanvasRenderingContext2D, l: L, rs: number) {
  const art = effectArt(l, rs);
  ctx.save();
  ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
  if (l.rotate) ctx.rotate(l.rotate * Math.PI / 180);
  ctx.drawImage(art, -l.w / 2, -l.h / 2, l.w, l.h);
  ctx.restore();
}

/* a small swatch of a tone, for the library */
export function toneSwatch(spec: ReturnType<typeof specOf>, size = 84, zoom = 2): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, size, size);
  paintTone(g, spec, size / zoom, size / zoom, zoom, { dpi: pageDpi(S.doc), seed: 7, color: "#000000" });
  return c;
}
