/** Bitmap caches for layers that are slow to paint (painted tiles, vector strokes, tones). A layer type opts in with
 *  `cache: true` and a `bounds()`; the bitmap is reused until the layer's content, the scale or the render epoch changes. */
interface Entry { key: string; canvas: HTMLCanvasElement | OffscreenCanvas; x: number; y: number; w: number; h: number }
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 256, MAX_DIM = 4096;
let epoch = 0;
/** Invalidates every cached bitmap (an image finished loading, fonts arrived, the theme changed). */
export function bumpRenderEpoch(): void { epoch++; }
export function dropLayerCache(id?: string): void { if (id) entries.delete(id); else entries.clear(); }

function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (h2 * 31 + c) | 0; }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length;
}
const surface = (w: number, h: number): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
};

/** Draws `paint` (page px) through a cached bitmap of the area `b` at `scale` device px per page px. `extra` joins the cache key. */
export function drawCached(ctx: CanvasRenderingContext2D, id: string, content: unknown, extra: string, scale: number,
  b: { x: number; y: number; w: number; h: number }, paint: (g: CanvasRenderingContext2D) => void): void {
  if (!(b.w > 0 && b.h > 0)) return;
  const s = Math.min(scale, MAX_DIM / b.w, MAX_DIM / b.h);
  const key = `${hash(JSON.stringify(content))}|${extra}|${s.toFixed(4)}|${epoch}|${b.x},${b.y},${b.w},${b.h}`;
  let e = entries.get(id);
  if (!e || e.key !== key) {
    const w = Math.max(1, Math.ceil(b.w * s)), h = Math.max(1, Math.ceil(b.h * s));
    const canvas = e && e.canvas.width === w && e.canvas.height === h ? e.canvas : surface(w, h);
    const g = canvas.getContext("2d") as CanvasRenderingContext2D;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    g.setTransform(s, 0, 0, s, -b.x * s, -b.y * s);
    paint(g);
    e = { key, canvas, ...b };
    entries.delete(id);
    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  } else entries.delete(id);
  entries.set(id, e);
  ctx.drawImage(e.canvas as CanvasImageSource, b.x, b.y, b.w, b.h);
}
