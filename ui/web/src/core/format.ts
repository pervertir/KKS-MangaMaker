import type { BookFormat, Doc } from "../types.ts";

export const MM_PER_IN = 25.4;
/** v1 projects drew their print guides on a canvas taken to be 182 mm wide, bleed included; their format reproduces that. */
export const V1_CANVAS_W_MM = 182;
export const DEFAULT_FORMAT: BookFormat = { trimW: 182, trimH: 257, bleed: 3, safe: 5, dpi: 600, binding: "rtl", colour: "mono" };

export const pxPerMm = (f: BookFormat): number => f.dpi / MM_PER_IN;
export const mmToPx = (f: BookFormat, mm: number): number => mm * pxPerMm(f);
export const pxToMm = (f: BookFormat, px: number): number => px / pxPerMm(f);

/** Canvas size of one page (span 1) or a spread (span 2): trim plus bleed on every outer edge. */
export function canvasSize(f: BookFormat, span: 1 | 2 = 1): { w: number; h: number } {
  return { w: Math.round(mmToPx(f, f.trimW * span + 2 * f.bleed)), h: Math.round(mmToPx(f, f.trimH + 2 * f.bleed)) };
}
/** Trim, bleed and safe boxes in canvas px for a page of the given canvas size. */
export function boxes(f: BookFormat, w: number, h: number) {
  const b = mmToPx(f, f.bleed), s = mmToPx(f, f.safe);
  return { bleed: { x: 0, y: 0, w, h }, trim: { x: b, y: b, w: w - 2 * b, h: h - 2 * b }, safe: { x: b + s, y: b + s, w: w - 2 * (b + s), h: h - 2 * (b + s) } };
}
/** The format a v1 project implies: the canvas is 182 mm wide with 3 mm bleed on each side (today's print
 *  guides), so the trim and safe lines land exactly where they were drawn and nothing on the page moves. */
export function inferFormat(doc: Pick<Doc, "width" | "height" | "reading">): BookFormat {
  const bleed = 3, dpi = doc.width / V1_CANVAS_W_MM * MM_PER_IN;
  const trimH = doc.height / dpi * MM_PER_IN - 2 * bleed;
  return { trimW: V1_CANVAS_W_MM - 2 * bleed, trimH, bleed, safe: 5, dpi, binding: doc.reading === "ltr" ? "ltr" : "rtl", colour: "mono" };
}
