/* The shapes the editor works with. project.json on disk is a Doc. */

export type LayerType = "panel" | "bubble" | "caption" | "text" | "image" | "vbubble" | "tone" | "speed";

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
  /** tone, speed lines: the panel that crops the layer */
  clip?: string | null;
  /** lettering */
  text?: string;
  sfx?: boolean;
  // the per-type settings (font, pattern, tail, ...) are set by normalize() in editor/state.ts
  [setting: string]: any;
}

export interface Page { id: string; bg: string; layers: Layer[] }

export interface Doc {
  version: number;
  title: string;
  reading: "rtl" | "ltr";
  width: number;
  height: number;
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
