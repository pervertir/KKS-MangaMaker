import { canvas } from "./blobs.ts";
import { drawTiles, inLayer } from "./raster.ts";
import { drawItems, outline, type Pt, type StrokeItem } from "./vector.ts";
import type { Layer } from "../types.ts";

/** The stroke being drawn right now, shown on its layer before it is merged. */
export interface Live {
  layer: string;
  kind: "brush" | "erase" | "ink" | "verase";
  canvas?: HTMLCanvasElement;
  alpha?: number;
  pts?: Pt[];
  style?: Omit<StrokeItem, "k" | "pts">;
}
export const LIVE: { cur: Live | null; pending: { layer: string; canvas: HTMLCanvasElement; x: number; y: number; alpha: number; erase: boolean }[] } =
  { cur: null, pending: [] };

let scratch: HTMLCanvasElement | null = null;
function scratchOf(w: number, h: number): HTMLCanvasElement {
  if (!scratch || scratch.width !== Math.ceil(w) || scratch.height !== Math.ceil(h)) scratch = canvas(w, h);
  else scratch.getContext("2d")!.clearRect(0, 0, scratch.width, scratch.height);
  return scratch;
}

export function drawPaint(ctx: CanvasRenderingContext2D, l: Layer) {
  inLayer(ctx, l, () => {
    const L = LIVE.cur?.layer === l.id ? LIVE.cur : null;
    const pend = LIVE.pending.filter(p => p.layer === l.id);
    if (l.type === "raster") {
      if (L?.kind === "erase" || pend.some(p => p.erase)) {
        const t = scratchOf(l.ow, l.oh), g = t.getContext("2d")!;
        drawTiles(g, l);
        for (const p of pend) { g.globalAlpha = p.alpha; g.globalCompositeOperation = p.erase ? "destination-out" : "source-over"; g.drawImage(p.canvas, p.x, p.y); }
        g.globalAlpha = 1;
        g.globalCompositeOperation = L?.kind === "erase" ? "destination-out" : "source-over";
        if (L?.canvas) { g.globalAlpha = L.alpha ?? 1; g.drawImage(L.canvas, 0, 0); }
        ctx.drawImage(t, 0, 0);
        return;
      }
      drawTiles(ctx, l);
      const a = ctx.globalAlpha;
      for (const p of pend) { ctx.globalAlpha = a * p.alpha; ctx.drawImage(p.canvas, p.x, p.y); }
      if (L?.canvas) { ctx.globalAlpha = a * (L.alpha ?? 1); ctx.drawImage(L.canvas, 0, 0); }
      ctx.globalAlpha = a;
    } else {
      drawItems(ctx, l);
      if (L?.kind === "ink" && L.pts?.length && L.style) {
        ctx.fillStyle = L.style.color;
        ctx.fill(outline(L.style, L.pts, false));
      }
    }
  });
}
