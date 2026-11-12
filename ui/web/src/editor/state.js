import { uid } from "./core.js";

/* ================================================================ state */
export const S = {
  cat: null, shots: [], projects: [],
  doc: null, name: "", page: 0, sel: null, tool: "move",
  view: { s: 0.25, tx: 0, ty: 0 },
  bubble: "001", panelShape: "rect", polyDraft: null, libTab: "shots", libFilter: "", vshape: "oval", tonePreset: 2, speedMode: "focus",
  dockTab: "panels",      // layers | panels | library: which list the dock shows under Properties
  adjust: null,           // panel id whose image is being panned/zoomed
  guides: [], showOrder: true, showGuides: true,
  undo: [], redo: [], dirty: false, savedAt: 0,
  jobs: {}, jobView: null, pod: null,
};
export const W = () => S.doc.width, H = () => S.doc.height;
export const page = () => S.doc.pages[S.page];
export const layers = () => page().layers;
export const selL = () => layers().find(l => l.id === S.sel) || null;
export const bubbleMeta = key => S.cat.bubbles.find(b => b.key === key) || S.cat.bubbles[0];

export function newDoc(title = "Untitled") {
  return { version: 1, title, reading: "rtl", width: 1800, height: 2700, maxFont: S.cat?.maxFont || 56,
    pages: [{ id: uid(), bg: "#ffffff", layers: [] }] };
}
export function normalize(doc) {
  doc.width ||= 1800; doc.height ||= 2700; doc.reading ||= "rtl"; doc.maxFont ||= 56;
  for (const p of doc.pages) {
    p.id ||= uid(); p.bg ||= "#ffffff"; p.layers ||= []; p.cuts ||= [];
    for (const l of p.layers) {
      // panels are the page's skeleton: locked unless unlocked on purpose, so lettering work cannot nudge a frame
      l.id ||= uid(); l.visible ??= true; l.locked ??= l.type === "panel"; l.opacity ??= 1; l.blend ||= "source-over"; l.rotate ||= 0;
      if (l.type === "panel") { l.border ??= 6; l.borderColor ||= "#000000"; l.fill ||= "#ffffff"; l.shape ||= "rect"; l.edge ||= "solid"; l.gap ??= 0; l.radius ??= 0; }
      if (l.type === "text") { l.font ||= l.sfx ? "Bangers" : "MMComic"; l.stroke ||= "#000000"; l.strokeWidth ??= l.sfx ? 10 : 0; l.align ||= "center"; }
      if (l.type === "caption") { l.fill ||= "#ffffff"; l.borderW ??= 4; }
      if (l.type === "vbubble") { l.shape ||= "oval"; l.fill ||= "#ffffff"; l.stroke ||= "#000000"; l.strokeW ??= 5; l.tailW ??= 0.22; l.seed ??= 1; l.spikes ??= 16; }
      if (l.type === "tone") { l.pattern ||= "dots"; l.size ??= 12; l.density ??= 0.35; l.angle ??= 45; l.fade ||= "none"; l.color ||= "#000000"; l.seed ??= 1; }
      if (l.type === "speed") { l.mode ||= "focus"; l.count ??= 160; l.thick ??= 14; l.inner ??= 0.45; l.jitter ??= 0.35; l.angle ??= 0; l.color ||= "#000000"; l.seed ??= 1; }
      if (["bubble", "caption", "text", "vbubble"].includes(l.type)) { l.color ||= "auto"; l.fontSize ??= 0; l.text ??= ""; }
    }
  }
  return doc;
}
