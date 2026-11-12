import { canvas, ensureTile, getTile, putTile } from "./blobs.ts";
import type { Layer } from "../types.ts";

/* Paint and line-art layers keep their content in their own pixels (ow x oh, fixed at creation); the
   layer box places them, so moving, scaling and rotating a layer never resamples what was drawn. */
export const TILE = 256;
export const isPaint = (l: Layer | null | undefined) => !!l && (l.type === "raster" || l.type === "vector");

/** page point -> the layer's own pixels */
export function toLocal(l: Layer, p: { x: number; y: number }) {
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2, a = -(l.rotate || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = p.x - cx, dy = p.y - cy, qx = dx * c - dy * s, qy = dx * s + dy * c;
  return { x: (qx + l.w / 2) * l.ow / l.w, y: (qy + l.h / 2) * l.oh / l.h };
}
/** page px per layer px */
export const pageScale = (l: Layer) => Math.sqrt(Math.abs((l.w / l.ow) * (l.h / l.oh))) || 1;
/** runs fn with the context in the layer's own pixels */
export function inLayer(ctx: CanvasRenderingContext2D, l: Layer, fn: () => void) {
  ctx.save();
  ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
  if (l.rotate) ctx.rotate(l.rotate * Math.PI / 180);
  ctx.translate(-l.w / 2, -l.h / 2);
  ctx.scale(l.w / l.ow, l.h / l.oh);
  fn();
  ctx.restore();
}

export function drawTiles(ctx: CanvasRenderingContext2D, l: Layer) {
  for (const [k, key] of Object.entries(l.tiles || {})) {
    const c = getTile(key as string);
    if (!c) continue;
    const [tx, ty] = k.split(",").map(Number);
    ctx.drawImage(c, tx * TILE, ty * TILE);
  }
}
export function tilesIn(l: Layer, x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const a = Math.max(0, Math.floor(x0 / TILE)), b = Math.max(0, Math.floor(y0 / TILE));
  const c = Math.min(Math.ceil(l.ow / TILE) - 1, Math.floor(x1 / TILE)), d = Math.min(Math.ceil(l.oh / TILE) - 1, Math.floor(y1 / TILE));
  for (let ty = b; ty <= d; ty++) for (let tx = a; tx <= c; tx++) out.push([tx, ty]);
  return out;
}
export const loadTiles = (l: Layer) => Promise.all(Object.values(l.tiles || {}).map(k => ensureTile(k as string)));

function empty(c: HTMLCanvasElement): boolean {
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}
/** Puts `src` (in layer pixels, its top-left at ox, oy) onto the layer's tiles inside box. Changed tiles get new refs. */
export async function mergeInto(l: Layer, src: CanvasImageSource, ox: number, oy: number,
                                box: { x0: number; y0: number; x1: number; y1: number }, op: GlobalCompositeOperation, alpha = 1) {
  await loadTiles(l);
  const tiles = { ...(l.tiles || {}) };
  for (const [tx, ty] of tilesIn(l, box.x0, box.y0, box.x1, box.y1)) {
    const k = `${tx},${ty}`, old = tiles[k] ? getTile(tiles[k]) : null;
    if (op === "destination-out" && !old) continue;
    const c = canvas(TILE, TILE), g = c.getContext("2d")!;
    if (old) g.drawImage(old, 0, 0);
    g.globalAlpha = alpha; g.globalCompositeOperation = op;
    g.drawImage(src, ox - tx * TILE, oy - ty * TILE);
    if (op === "destination-out" && empty(c)) delete tiles[k];
    else tiles[k] = await putTile(c);
  }
  l.tiles = tiles;
}
/** alpha (0..255) of the layer's own pixel */
export function alphaAt(l: Layer, x: number, y: number): number {
  const key = l.tiles?.[`${Math.floor(x / TILE)},${Math.floor(y / TILE)}`], c = key && getTile(key);
  if (!c) return 0;
  return c.getContext("2d", { willReadFrequently: true })!.getImageData(Math.floor(x) % TILE, Math.floor(y) % TILE, 1, 1).data[3];
}
