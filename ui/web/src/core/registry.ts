import type { Layer } from "../types.ts";
import { rect, transform, type Region } from "./geometry/region.ts";
import type { TransformRules } from "./transform.ts";

export interface DrawOpts {
  /** device px per page px the result will be shown at (pick image LOD and tone resolution from it) */
  rs?: number;
  /** drawing for a file, not the screen: no placeholders, no screen-only layers */
  export?: boolean;
  ghost?: boolean;
  [more: string]: unknown;
}

/** How a layer type behaves. Built-in types live in editor/drawing.js; new types register here,
 *  and the editor draws, hit-tests, clips and fills defaults for them through this table. */
export interface LayerTypeDef<L extends Layer = Layer> {
  type: string;
  label: string;
  /** Fills in missing settings on load and on creation (the per-type part of normalize()). */
  defaults?(l: L): void;
  /** Paints the layer in page px. Opacity, blend mode and the clip to its panel are already applied. */
  draw(ctx: CanvasRenderingContext2D, l: L, opt: DrawOpts): void;
  /** The area the layer covers, in page px; default is its rotated box. Used for hit tests, clipping and selection. */
  outline?(l: L): Region;
  /** true when a point (page px) hits the layer; default is the outline. */
  hit?(l: L, x: number, y: number): boolean;
  /** false for guides and rulers: drawn on screen, never exported. */
  printable?: boolean;
  /** Layers with clip set to this layer's id are cropped to its outline (panels). */
  clipsOthers?: boolean;
  /** Paint once into a bitmap and reuse it on screen until the layer changes; needs `bounds`. Files are always painted fresh. */
  cache?: boolean;
  /** How the shared transform box treats the layer; `false` hides it. `onScale` adjusts content that does not
   *  follow the box by itself (a tail point, a path in layer coordinates) from the layer as it was at drag start. */
  transform?: false | (TransformRules & { onScale?(l: L, before: L): void });
  /** Everything the layer paints, in page px, including strokes and shadows. */
  bounds?(l: L): { x: number; y: number; w: number; h: number };
}

const defs = new Map<string, LayerTypeDef<any>>();
export function defineLayerType<L extends Layer>(def: LayerTypeDef<L>): LayerTypeDef<L> {
  if (defs.has(def.type)) console.warn(`layer type ${def.type} registered twice; the last one wins`);
  defs.set(def.type, def);
  return def;
}
export const layerType = (type: string): LayerTypeDef | undefined => defs.get(type);
export const layerTypes = (): LayerTypeDef[] => [...defs.values()];

/** A layer's rotated box as a region in page px. */
export function boxOutline(l: Pick<Layer, "x" | "y" | "w" | "h" | "rotate">): Region {
  const r = rect(l.x, l.y, l.w, l.h);
  if (!l.rotate) return r;
  const a = l.rotate * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  return transform(r, [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]);
}

const outlineHooks: ((l: Layer) => Region | null)[] = [];
/** Lets a module supply the outline of built-in types (panel shapes beyond rectangles, for instance). First non-null wins. */
export function provideOutline(fn: (l: Layer) => Region | null): void { outlineHooks.unshift(fn); }
export function outlineOf(l: Layer): Region {
  for (const f of outlineHooks) { const r = f(l); if (r) return r; }
  return defs.get(l.type)?.outline?.(l) ?? boxOutline(l);
}
