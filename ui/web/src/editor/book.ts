import { canvasSize, pxPerMm as fmtPxPerMm } from "../core/format.ts";
import type { BookFormat, Doc, Numbering, Page } from "../types.ts";

export interface Rect { x: number; y: number; w: number; h: number }

export const FORMAT_PRESETS: Record<string, { label: string; trimW: number; trimH: number }> = {
  legacy: { label: "Editor default (176 × 267 mm)", trimW: 176, trimH: 267 },
  b6: { label: "Tankōbon B6 (128 × 182 mm)", trimW: 128, trimH: 182 },
  b5: { label: "Magazine B5 (182 × 257 mm)", trimW: 182, trimH: 257 },
  a5: { label: "A5 (148 × 210 mm)", trimW: 148, trimH: 210 },
  us: { label: "US comic (6.625 × 10.25 in)", trimW: 168.3, trimH: 260.4 },
};

export function defaultNumbering(): Numbering {
  return { show: false, start: 1, style: "arabic", position: "outer", edge: "bottom", offset: 6, size: 3.5, font: "MMComic" };
}
export function normalizeBook(doc: Doc): void {
  doc.format.preset ??= Object.keys(FORMAT_PRESETS).find(k => Math.abs(FORMAT_PRESETS[k].trimW - doc.format.trimW) < 0.5 && Math.abs(FORMAT_PRESETS[k].trimH - doc.format.trimH) < 0.5) || "custom"; doc.format.gutter ??= 8; doc.format.exportBleed ??= true;
  doc.numbering = { ...defaultNumbering(), ...(doc.numbering || {}) };
  for (const p of doc.pages) if (p.span !== 2) delete p.span;
}
/* covers and blank pages count as pages but carry no number */
export const unnumbered = (pg: Page): boolean => !!pg.noNumber || pg.kind === "cover" || pg.kind === "blank";

export const pxPerMm = (doc: Doc): number => fmtPxPerMm(doc.format);
export const bleedPx = (doc: Doc): number => doc.format.bleed * pxPerMm(doc);
/* a spread is two pages side by side with no bleed at the fold */
export const pageWidth = (doc: Doc, pg: Page): number => pg.span === 2 ? 2 * doc.width - 2 * bleedPx(doc) : doc.width;
/* ---------------------------------------------------------------- slots: page positions in the printed book */
export function slotOf(doc: Doc, i: number): number {
  let s = 1;
  for (let k = 0; k < i; k++) s += doc.pages[k].span === 2 ? 2 : 1;
  return s;
}
export const slotCount = (doc: Doc): number => doc.pages.reduce((n, p) => n + (p.span === 2 ? 2 : 1), 0);
/* odd slots are right-hand pages in a left-to-right book and left-hand pages in a manga */
export const isRecto = (slot: number): boolean => slot % 2 === 1;
export function sideOf(doc: Doc, slot: number): "left" | "right" {
  const rtl = doc.reading !== "ltr";
  return isRecto(slot) !== rtl ? "right" : "left";
}
/* a spread has to open flat: it must start on a verso (even slot) */
export const spreadMisplaced = (doc: Doc, i: number): boolean => doc.pages[i].span === 2 && !!(slotOf(doc, i) % 2);
export function slotLabel(doc: Doc, i: number): string {
  const s = slotOf(doc, i);
  return doc.pages[i].span === 2 ? `${s}–${s + 1}` : String(s);
}

/* the halves of a page in canvas pixels, each with its own bleed, in slot order */
export interface Half { slot: number; side: "left" | "right"; rect: Rect }
export function halves(doc: Doc, i: number): Half[] {
  const pg = doc.pages[i], s = slotOf(doc, i), w = doc.width, h = doc.height;
  if (pg.span !== 2) return [{ slot: s, side: sideOf(doc, s), rect: { x: 0, y: 0, w, h } }];
  const left = { x: 0, y: 0, w, h }, right = { x: pageWidth(doc, pg) - w, y: 0, w, h };
  const first = sideOf(doc, s);
  return [{ slot: s, side: first, rect: first === "left" ? left : right }, { slot: s + 1, side: sideOf(doc, s + 1), rect: first === "left" ? right : left }];
}

/* ---------------------------------------------------------------- print geometry */
export interface Guides { trim: Rect; safe: Rect[]; fold: number | null; gutter: Rect[] }
export function guides(doc: Doc, pg: Page): Guides {
  const k = pxPerMm(doc), f = doc.format, b = f.bleed * k, sf = f.safe * k, gt = (f.gutter ?? 0) * k;
  const W = pageWidth(doc, pg), H = doc.height;
  const trim = { x: b, y: b, w: W - 2 * b, h: H - 2 * b };
  if (pg.span !== 2) {
    // the inner (bound) edge of a single page also gets the gutter
    const i = doc.pages.indexOf(pg), inner = i < 0 ? null : (sideOf(doc, slotOf(doc, i)) === "right" ? "left" : "right");
    const x0 = b + sf + (inner === "left" ? gt : 0), x1 = W - b - sf - (inner === "right" ? gt : 0);
    return { trim, safe: [{ x: x0, y: b + sf, w: x1 - x0, h: H - 2 * (b + sf) }], fold: null, gutter: [] };
  }
  const mid = W / 2, y = b + sf, hh = H - 2 * (b + sf);
  return {
    trim, fold: mid,
    safe: [{ x: b + sf, y, w: mid - gt - b - sf, h: hh }, { x: mid + gt, y, w: W - b - sf - mid - gt, h: hh }],
    gutter: [{ x: mid - gt, y: b, w: 2 * gt, h: H - 2 * b }],
  };
}
/* the area art can use without the trim, the fold or the binding eating it */
export function safeArea(doc: Doc, pg: Page): Rect {
  const s = guides(doc, pg).safe;
  const x0 = Math.min(...s.map(r => r.x)), x1 = Math.max(...s.map(r => r.x + r.w));
  return { x: x0, y: s[0].y, w: x1 - x0, h: s[0].h };
}

/* ---------------------------------------------------------------- page numbers (nombre) */
export function roman(n: number): string {
  if (n <= 0) return String(n);
  const t: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return out;
}
export function numberText(doc: Doc, slot: number): string {
  const n = slot - 1 + doc.numbering.start;
  return doc.numbering.style === "roman" ? roman(n) : String(n);
}
export interface Nombre { text: string; x: number; y: number; align: CanvasTextAlign; size: number; font: string }
export function nombres(doc: Doc, i: number): Nombre[] {
  const nb = doc.numbering, pg = doc.pages[i];
  if (!nb.show || unnumbered(pg)) return [];
  const k = pxPerMm(doc), b = doc.format.bleed * k, off = nb.offset * k, tw = doc.width - 2 * b;
  return halves(doc, i).map(hf => {
    const tx = hf.rect.x > 0 ? doc.width - b : b;
    let x: number, align: CanvasTextAlign;
    if (nb.position === "center") { x = tx + tw / 2; align = "center"; }
    else if ((nb.position === "outer") === (hf.side === "right")) { x = tx + tw - off; align = "right"; }
    else { x = tx + off; align = "left"; }
    const y = nb.edge === "top" ? b + off : doc.height - b - off;
    return { text: numberText(doc, hf.slot), x, y, align, size: nb.size * k, font: nb.font };
  });
}
export function drawNombres(ctx: CanvasRenderingContext2D, doc: Doc, i: number): void {
  const list = nombres(doc, i);
  if (!list.length) return;
  ctx.save();
  ctx.fillStyle = "#000000"; ctx.textBaseline = "middle";
  for (const n of list) { ctx.font = `${n.size}px ${JSON.stringify(n.font)}, sans-serif`; ctx.textAlign = n.align; ctx.fillText(n.text, n.x, n.y); }
  ctx.restore();
}

/* ---------------------------------------------------------------- reformat */
const SCALED = ["border", "strokeWidth", "strokeW", "borderW", "size", "fontSize", "thick"];
/* changes the canvas to a new format and rescales what is on the pages to match */
export function applyFormat(doc: Doc, next: BookFormat): boolean {
  const before = { w: doc.width, h: doc.height }, { w, h } = canvasSize(next);
  doc.format = { ...next, binding: doc.reading };
  if (w === before.w && h === before.h) return false;
  const sx = w / before.w, sy = h / before.h, s = Math.min(sx, sy);
  doc.width = w; doc.height = h;
  doc.maxFont = Math.max(8, Math.round(doc.maxFont * s));
  for (const p of doc.pages) for (const l of p.layers) {
    l.x *= sx; l.y *= sy; l.w *= sx; l.h *= sy;
    for (const key of SCALED) if (typeof l[key] === "number") l[key] *= s;
  }
  return true;
}
