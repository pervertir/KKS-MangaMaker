/* The shapes the editor works with. project.json on disk is a Doc. */

/** Built-in types; modules add more through core/registry.ts defineLayerType(). */
export type LayerType = "panel" | "bubble" | "caption" | "text" | "image" | "vbubble" | "tone" | "speed" | (string & {});

/** The render placed in a panel. */
export interface PanelImage {
  ref: string;
  fit: "cover" | "contain";
  zoom?: number;
  flip?: boolean;
  gray?: boolean;
  [more: string]: unknown;
}

/** Anything on a page. Every type shares the box and the stacking fields; the rest depends on `type`. */
export interface Layer {
  id: string;
  type: LayerType;
  x: number; y: number; w: number; h: number;
  rotate: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: string;
  name?: string;
  /** panel: the shot it shows and the render placed in it */
  shot?: string;
  image?: PanelImage | null;
  /** the panel that crops the layer; any layer type may set it */
  clip?: string | null;
  /** bumped whenever the layer changes, so caches can tell */
  rev?: number;
  /** lettering */
  text?: string;
  sfx?: boolean;
  // the per-type settings (font, pattern, tail, ...) are set by normalize() in editor/state.ts
  [setting: string]: any;
}

/** Physical page size. Lengths in mm; dpi turns them into canvas px (see core/format.ts). */
export interface BookFormat {
  trimW: number;
  trimH: number;
  bleed: number;
  safe: number;
  dpi: number;
  binding: "rtl" | "ltr";
  colour: "mono" | "grey" | "colour";
  /** the preset the size came from (book.ts FORMAT_PRESETS) or "custom" */
  preset?: string;
  /** extra margin (mm) on the bound edge, and on each side of a spread's fold */
  gutter?: number;
  /** exported pages keep the bleed (print) or are cut to the trim (screen) */
  exportBleed?: boolean;
}

export interface Numbering {
  show: boolean;
  start: number;
  style: "arabic" | "roman";
  position: "outer" | "center" | "inner";
  edge: "bottom" | "top";
  /** mm in from the trim */
  offset: number;
  /** mm */
  size: number;
  font: string;
}

export interface Page {
  id: string;
  bg: string;
  layers: Layer[];
  /** 2 for a two-page spread drawn on one double-width canvas */
  span?: 1 | 2;
  kind?: "page" | "cover" | "blank";
  /** title of the chapter this page opens */
  chapter?: string;
  noNumber?: boolean;
}

export interface Doc {
  version: number;
  title: string;
  reading: "rtl" | "ltr";
  /** canvas px of a single page, bleed included; equals canvasSize(format) */
  width: number;
  height: number;
  format: BookFormat;
  numbering: Numbering;
  maxFont: number;
  pages: Page[];
}

/** A folder under shots/: one posed scene and what was rendered from it. */
export interface Shot {
  name: string;
  pose?: string | null;
  renders: string[];
  finals: string[];
  [more: string]: unknown;
}

export interface BubbleTemplate { key: string; ref: string; w: number; h: number }
export interface LayoutTemplate { n: number; ref: string; rects: number[][] }
export interface Asset { ref: string; name: string; multiply: boolean }

/** /api/catalog: what the server found to work with. */
export interface Catalog {
  bubbles: BubbleTemplate[];
  layouts: LayoutTemplate[];
  assets: Record<string, Asset[]>;
  maxFont?: number;
  [more: string]: unknown;
}

export interface Job { id: string; label: string; lines: string[]; next: number; done: boolean; [more: string]: unknown }

/** What the Svelte components show of a job and of a passing message. */
export interface JobChip { id: string; label: string; state: "run" | "ok" | "bad" }
export interface Toast { id: number; text: string; kind: string }

export type DockTab = "layers" | "panels" | "library";
