import { uid } from "./core.js";
import { defaultNumbering, normalizeBook, pageWidth } from "./book.ts";
import { canvasSize, DEFAULT_FORMAT, inferFormat } from "../core/format.ts";
import { layerType } from "../core/registry.ts";
import type { BubbleTemplate, Catalog, Doc, DockTab, Job, Layer, Page, Shot } from "../types.ts";

/* ================================================================ state */
export interface EditorState {
  cat: Catalog | null;
  shots: Shot[];
  projects: string[];
  doc: Doc | null;
  name: string;
  page: number;
  sel: string | null;
  tool: string;
  view: { s: number; tx: number; ty: number };
  bubble: string;
  libTab: string;
  libFilter: string;
  vshape: string;
  tonePreset: number;
  speedMode: string;
  /** which list the dock shows under Properties */
  dockTab: DockTab;
  /** panel id whose image is being panned/zoomed */
  adjust: string | null;
  guides: unknown[];
  showOrder: boolean;
  showGuides: boolean;
  undo: string[];
  redo: string[];
  dirty: boolean;
  savedAt: number;
  jobs: Record<string, Job>;
  jobView: string | null;
  pod: { running?: boolean; [more: string]: unknown } | null;
  // scratch values the tools keep between events (timers, the last snapshot, ...)
  [scratch: string]: any;
}

export const S: EditorState = {
  cat: null, shots: [], projects: [],
  doc: null, name: "", page: 0, sel: null, tool: "move",
  view: { s: 0.25, tx: 0, ty: 0 },
  bubble: "001", panelShape: "rect", polyDraft: null, libTab: "shots", libFilter: "", vshape: "oval", tonePreset: 2, speedMode: "focus",
  dockTab: "panels",
  adjust: null,
  guides: [], showOrder: true, showGuides: true,
  undo: [], redo: [], dirty: false, savedAt: 0,
  jobs: {}, jobView: null, pod: null,
};
export const W = (): number => pageWidth(S.doc!, page()), H = (): number => S.doc!.height;
export const page = (): Page => S.doc!.pages[S.page];
export const layers = (): Layer[] => page().layers;
export const selL = (): Layer | null => layers().find(l => l.id === S.sel) || null;
export const bubbleMeta = (key: string): BubbleTemplate => S.cat!.bubbles.find(b => b.key === key) || S.cat!.bubbles[0];

export function newDoc(title = "Untitled", format = inferFormat({ width: 1800, height: 2700, reading: "rtl" })): Doc {
  const { w, h } = canvasSize(format);
  return { version: 1, title, reading: format.binding, width: w, height: h, format, numbering: defaultNumbering(), maxFont: S.cat?.maxFont || 56,
    pages: [{ id: uid(), bg: "#ffffff", layers: [] }] };
}
/* Fills in what an older or hand-written project leaves out, so the rest of the editor can rely on it. */
export function normalize(doc: Doc): Doc {
  doc.width ||= 1800; doc.height ||= 2700; doc.reading ||= "rtl"; doc.maxFont ||= 56;
  doc.format = { ...DEFAULT_FORMAT, ...inferFormat(doc), ...doc.format };
  normalizeBook(doc);
  for (const p of doc.pages) {
    p.id ||= uid(); p.bg ||= "#ffffff"; p.layers ||= [];
    for (const l of p.layers) {
      // panels are the page's skeleton: locked unless unlocked on purpose, so lettering work cannot nudge a frame
      l.id ||= uid(); l.rev ??= 0; l.visible ??= true; l.locked ??= l.type === "panel"; l.opacity ??= 1; l.blend ||= "source-over"; l.rotate ||= 0;
      if (l.type === "panel") { l.border ??= 6; l.borderColor ||= "#000000"; l.fill ||= "#ffffff"; l.shape ||= "rect"; l.edge ||= "solid"; l.gap ??= 0; l.radius ??= 0; }
      if (l.type === "text") { l.font ||= l.sfx ? "Bangers" : "MMComic"; l.stroke ||= "#000000"; l.strokeWidth ??= l.sfx ? 10 : 0; l.align ||= "center"; }
      if (l.type === "caption") { l.fill ||= "#ffffff"; l.borderW ??= 4; }
      if (l.type === "vbubble") { l.shape ||= "oval"; l.fill ||= "#ffffff"; l.stroke ||= "#000000"; l.strokeW ??= 5; l.tailW ??= 0.22; l.seed ??= 1; l.spikes ??= 16; }
      if (l.type === "tone") { l.pattern ||= "dots"; l.size ??= 12; l.density ??= 0.35; l.angle ??= 45; l.fade ||= "none"; l.color ||= "#000000"; l.seed ??= 1; }
      if (l.type === "speed") { l.mode ||= "focus"; l.count ??= 160; l.thick ??= 14; l.inner ??= 0.45; l.jitter ??= 0.35; l.angle ??= 0; l.color ||= "#000000"; l.seed ??= 1; }
      if (["bubble", "caption", "text", "vbubble"].includes(l.type)) { l.color ||= "auto"; l.fontSize ??= 0; l.text ??= ""; }
      layerType(l.type)?.defaults?.(l);
    }
  }
  return doc;
}
