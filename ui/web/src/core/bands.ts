/** Splits a w×h image into horizontal bands of at most `maxPx` pixels each (Safari refuses canvases over 16.7 M px). */
export const MAX_CANVAS_PX = 16_000_000;
export function planBands(w: number, h: number, maxPx = MAX_CANVAS_PX): { y: number; h: number }[] {
  const rows = Math.max(1, Math.floor(maxPx / Math.max(1, w)));
  const out: { y: number; h: number }[] = [];
  for (let y = 0; y < h; y += rows) out.push({ y, h: Math.min(rows, h - y) });
  return out;
}
