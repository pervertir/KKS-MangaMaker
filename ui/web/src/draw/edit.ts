import type { Item } from "./vector.ts";
import { commit } from "../editor/history.js";
import { requestDraw } from "../editor/view.js";
/** a layer as Properties holds it */
type Layer = Record<string, any>;

/* Whole-layer edits from Properties. Strokes keep their samples, so width, smoothing and colour can change any time. */
const done = (_l: Layer, msg: string) => { commit(msg); requestDraw(); };
const strokes = (l: Layer) => ((l.items || []) as Item[]).filter(i => i.k === "s").length;
export const counts = (l: Layer) => ({ strokes: strokes(l), fills: (l.items || []).length - strokes(l), tiles: Object.keys(l.tiles || {}).length });
export function recolor(l: Layer, color: string, what: "lines" | "fills" | "all") {
  l.items = ((l.items || []) as Item[]).map(i => (what === "all" || (what === "lines") === (i.k === "s") ? { ...i, color } : i));
  done(l, "Recoloured");
}
export function widen(l: Layer, k: number) {
  l.items = ((l.items || []) as Item[]).map(i => (i.k === "s" ? { ...i, size: Math.max(0.3, +(i.size * k).toFixed(2)) } : i));
  done(l, k > 1 ? "Thicker lines" : "Thinner lines");
}
export function smoothing(l: Layer, v: number) {
  l.items = ((l.items || []) as Item[]).map(i => (i.k === "s" ? { ...i, smoothing: v, streamline: Math.min(0.9, v * 0.8) } : i));
  done(l, "Smoothing");
}
export function clearLayer(l: Layer) {
  if (l.type === "raster") l.tiles = {}; else l.items = [];
  done(l, "Cleared");
}
