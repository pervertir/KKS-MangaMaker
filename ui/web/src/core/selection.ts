import { combine, isEmpty, offset, trace, type CombineMode, type Region } from "./geometry/region.ts";

/** The page's region selection: an area in page px, resolution independent. Tones, fills, clears and
 *  "new layer from selection" read it; the marquee, lasso, polygon and wand tools write it. */
let current: Region | null = null;
let pageId: string | null = null;
const listeners = new Set<(r: Region | null) => void>();
const emit = () => listeners.forEach(f => f(current));

export const selection = (): Region | null => current;
export const selectionPage = (): string | null => pageId;
export const hasSelection = (): boolean => !isEmpty(current);
export function setSelection(r: Region | null, page: string | null = pageId, mode: CombineMode = "replace"): void {
  if (page !== pageId) { current = null; pageId = page; }
  current = r && !isEmpty(r) ? combine(mode === "replace" ? null : current, r, mode) : mode === "replace" ? null : current;
  if (isEmpty(current)) current = null;
  emit();
}
export function clearSelection(): void { if (current) { current = null; emit(); } }
export function growSelection(d: number): void { if (current) { current = offset(current, d); if (isEmpty(current)) current = null; emit(); } }
export function onSelection(f: (r: Region | null) => void): () => void { listeners.add(f); return () => listeners.delete(f); }
/** Selection mode from modifier keys, as in most paint programs: Shift adds, Alt subtracts, both intersect. */
export const modeFromKeys = (shift: boolean, alt: boolean): CombineMode => shift && alt ? "intersect" : shift ? "add" : alt ? "subtract" : "replace";

/** Marching ants in page px; `px` is one screen pixel in page px, `t` a time in ms so the ants march. */
export function drawAnts(ctx: CanvasRenderingContext2D, px: number, t = performance.now()): void {
  if (!current) return;
  ctx.save();
  ctx.beginPath(); trace(ctx, current);
  ctx.lineWidth = px; ctx.setLineDash([5 * px, 5 * px]);
  ctx.strokeStyle = "#ffffff"; ctx.lineDashOffset = 0; ctx.stroke();
  ctx.strokeStyle = "#000000"; ctx.lineDashOffset = ((t / 60) % 10) * px; ctx.stroke();
  ctx.restore();
}
