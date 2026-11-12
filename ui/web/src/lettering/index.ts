/* The balloon layer type and the lettering actions the editor calls. */
import type { Layer } from "../types.ts";
import { defineLayerType } from "../core/registry.ts";
import type { Region } from "../core/geometry/region.ts";
import { themeOf, themed } from "../editor/creation.js";
import { lum } from "../editor/manga-tools.js";
import { S, bubbleMeta } from "../editor/state.ts";
import { drawText } from "../editor/text.js";
import { thumb } from "../editor/images.js";
import { type Tail, drawBalloons, fromVBubble, geo, mergeGroup, newTail, textShape, traceImage } from "./balloon.ts";
import { inPoly, nodesToPath, presetNodes, PRESETS } from "./geom.ts";
import { edit } from "./handles.ts";
import { CURVES, curvePath } from "./sfx.ts";

export { PRESETS, CURVES, edit, newTail };
export type { Tail };

function pageOf(l: Layer) {
  return S.doc?.pages.find((p: any) => p.layers.some((q: Layer) => q.id === l.id)) || null;
}
function toPage(l: Layer, x: number, y: number): [number, number] {
  const a = (l.rotate || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [l.x + l.w / 2 + x * c - y * s, l.y + l.h / 2 + x * s + y * c];
}
function toLocal(l: Layer, x: number, y: number): [number, number] {
  const a = -(l.rotate || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - l.x - l.w / 2, dy = y - l.y - l.h / 2;
  return [dx * c - dy * s, dx * s + dy * c];
}
export const balloonText = (l: Layer) => {
  const sh = textShape(l);
  return { sh, color: l.color === "auto" ? (lum(l.fill) > 0.43 ? "#111111" : "#ffffff") : l.color };
};

defineLayerType({
  type: "balloon",
  label: "Balloon",
  defaults(l: Layer) {
    l.preset ||= "oval"; l.fill ||= "#ffffff"; l.stroke ||= "#000000"; l.strokeW ??= 5; l.seed ??= 1;
    l.tails ||= []; l.merge ??= true; l.color ||= "auto"; l.fontSize ??= 0; l.text ??= ""; l.font ||= "MMComic";
    if (!l.path?.subs?.length) l.path = nodesToPath(presetNodes(l.preset, l.w, l.h, l.seed, l.spikes || 16), l.w, l.h);
  },
  draw(ctx, l, opt) {
    const pg = pageOf(l), TH = themeOf(opt);
    const dragged = S.drag?.layer?.id;
    const group = pg && !opt.solo && dragged !== l.id ? mergeGroup(l, pg.layers.filter((q: Layer) => q.id !== dragged)) : [l];
    if (group.length > 1 && group[group.length - 1].id !== l.id) return;      // drawn together with the top one
    const ls = group.map(q => q.id === l.id ? l : themed(q, TH));
    const maxFont = S.doc!.maxFont || 56;
    drawBalloons(ctx, ls, b => {
      const { sh, color } = balloonText(b);
      (drawText as any)(ctx, { ...b, strokeWidth: 0 }, sh.cx, sh.cy, sh.w, sh.h, maxFont, color, sh);
    });
  },
  outline(l): Region {
    return [geo(l).poly.map(([x, y]) => toPage(l, x, y))];
  },
  hit(l, x, y) {
    const [qx, qy] = toLocal(l, x, y);
    if (inPoly([qx, qy], geo(l).poly)) return true;
    return (l.tails || []).some((t: Tail) => Math.hypot(qx - t.tip.x, qy - t.tip.y) < Math.min(l.w, l.h) * 0.08);
  },
});

/** A new balloon from the Drawn bubble tool. */
export function newBalloon(preset: string, x: number, y: number, w: number, h: number): Partial<Layer> {
  const seed = Math.floor(Math.random() * 1e6);
  const l: Partial<Layer> = { type: "balloon", preset, x, y, w, h, text: "", seed, spikes: 16, dash: preset === "whisper",
    path: nodesToPath(presetNodes(preset, w, h, seed, 16), w, h), font: preset === "burst" ? "Bangers" : "MMComic", tails: [] };
  if (preset !== "flash" && preset !== "rect") l.tails = [{ kind: preset === "cloud" ? "dots" : "curved", tip: { x: -w * 0.18, y: h * 0.85 }, width: 0.22, bend: 0.18 }];
  return l;
}

/** Puts a fresh preset outline on a balloon, keeping its tails and text. */
export function applyPreset(l: Layer, preset: string): void {
  l.preset = preset; l.dash = preset === "whisper";
  l.path = nodesToPath(presetNodes(preset, l.w, l.h, l.seed || 1, l.spikes || 16), l.w, l.h);
  edit.node = -1;
}

/** Turns a drawn bubble or a template bubble into an editable balloon in place. */
export async function makeEditable(l: Layer): Promise<boolean> {
  if (l.type === "vbubble") { const b = fromVBubble(l); for (const k of Object.keys(l)) delete l[k]; Object.assign(l, b); edit.shape = l.id; return true; }
  if (l.type !== "bubble") return false;
  const m = bubbleMeta(l.bubble), tr = await traceImage(thumb(m.ref, 720));
  if (!tr) return false;
  const nodes = l.flip ? tr.nodes.map(n => ({ x: -n.x, y: n.y, ...(n.i ? { i: [-n.o![0], n.o![1]] as [number, number], o: [-n.i[0], n.i[1]] as [number, number] } : {}) })).reverse() : tr.nodes;
  const keep = { id: l.id, x: l.x, y: l.y, w: l.w, h: l.h, rotate: l.rotate, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend,
    text: l.text, font: l.font, fontSize: l.fontSize, bold: l.bold, italic: l.italic, vertical: l.vertical, color: l.color, name: l.name };
  for (const k of Object.keys(l)) delete l[k];
  Object.assign(l, keep, { type: "balloon", preset: "traced", fill: tr.dark ? "#111111" : "#ffffff", stroke: tr.dark ? "#ffffff" : "#000000",
    strokeW: 5, tails: [], merge: true, seed: 1, path: nodesToPath(nodes, l.w, l.h) });
  edit.shape = l.id;
  return true;
}

/** Puts an SFX on a preset baseline (or takes it off with null). */
export function setCurve(l: Layer, key: string | null): void {
  const c = key && CURVES.find(q => q[0] === key);
  l.curve = c ? curvePath(c[2], l.w, l.h) : null;
  if (c && key === "down") l.vertical = true;
  edit.glyph = -1;
}

/** Do two balloons share one merged outline on the page? (The checker leaves those overlaps alone.) */
export function merged(a: Layer, b: Layer): boolean {
  if (a.type !== "balloon" || b.type !== "balloon") return false;
  const pg = pageOf(a);
  return !!pg && mergeGroup(a, pg.layers).some(q => q.id === b.id);
}
