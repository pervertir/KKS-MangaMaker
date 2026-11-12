/* Turning the page selection, a library tone or a click into effect layers. */
import { S, layers, page, selL } from "../state.ts";
import { addLayer, insertIndexForPanel } from "../creation.js";
import { commit } from "../history.js";
import { status, toast } from "../misc.js";
import { requestDraw } from "../view.js";
import { clearSelection, selection, selectionPage } from "../../core/selection.ts";
import { bounds, intersect, rect, type Region } from "../../core/geometry/region.ts";
import type { Box } from "./geom.ts";
import { BUILTIN, toneById, type ToneSpec } from "./tones.ts";
import { SPEED_DEFAULTS } from "./speed.ts";

type L = Record<string, any>;

/** the page selection when it belongs to the page on screen */
export function pageSelection(): Region | null {
  const r = selection();
  return S.doc && r && selectionPage() === page().id ? r : null;
}
export const toneFields = (spec: ToneSpec): L => ({ shape: spec.shape, lpi: spec.lpi, pct: spec.pct, angle: spec.angle,
  grad: spec.grad ? JSON.parse(JSON.stringify(spec.grad)) : null, tile: spec.tile || null, tileScale: spec.tileScale || 1 });
export const currentToneFields = (): L => toneFields((toneById(S.toneId) || BUILTIN[0]).spec);
export const speedFields = (mode: string = S.speedMode): L => ({ mode, ...JSON.parse(JSON.stringify(SPEED_DEFAULTS[mode] || SPEED_DEFAULTS.focus)) });

function pageBox(r: Region): Box | null {
  const b = bounds(intersect(r, rect(0, 0, S.doc!.width, S.doc!.height)));
  return b && b.w > 2 && b.h > 2 ? b : null;
}
function panelAt(x: number, y: number): L | null {
  return [...layers()].reverse().find(l => l.type === "panel" && l.visible && x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) || null;
}
const boxOf = (l: L): Box => ({ x: l.x, y: l.y, w: l.w, h: l.h, rotate: l.rotate || 0 });

/* A new tone or speed-lines layer over the selection (or the given box), above the frames and below lettering.
   With a box and a panel, it is cropped to that panel. */
export function addEffect(type: "tone" | "speed", props: L, box?: Box | null, clipPanel?: L | null): L | null {
  const reg = box ? null : pageSelection(), b = box || (reg && pageBox(reg));
  if (!b) { status("Select an area first, click a panel, or drag a box"); return null; }
  const pl = box ? clipPanel || null : null;
  const near = pl || panelAt(b.x + b.w / 2, b.y + b.h / 2);
  const at = near ? layers().indexOf(near as any) + 1 : insertIndexForPanel();
  const l = addLayer({ type, x: b.x, y: b.y, w: b.w, h: b.h, clip: pl ? pl.id : null, seed: Math.floor(Math.random() * 1e6), ...props }, at);
  if (reg) { l.region = reg; l.regionAt = boxOf(l); }
  commit(type === "tone" ? "Added screentone" : "Added speed lines"); requestDraw();
  return l;
}
/* library pick: changes the selected tone, or lays a new one over the selection */
export function applyTone(spec: ToneSpec) {
  const l = selL();
  if (l?.type === "tone" && !pageSelection()) { Object.assign(l, toneFields(spec)); commit("Tone changed"); requestDraw(); return l; }
  return addEffect("tone", toneFields(spec));
}
export function regionFromSelection(l: L) {
  const reg = pageSelection();
  if (!reg) return toast("Make a selection first", "err");
  l.region = reg; l.regionAt = boxOf(l); commit("Area set from selection"); requestDraw();
}
export function fitToSelection(l: L) {
  const reg = pageSelection(), b = reg && pageBox(reg);
  if (!b) return toast("Make a selection first", "err");
  Object.assign(l, { x: b.x, y: b.y, w: b.w, h: b.h, rotate: 0, erase: [] });
  l.region = reg; l.regionAt = boxOf(l);
  commit("Fitted to selection"); requestDraw();
}
export function clearRegion(l: L) { l.region = null; l.regionAt = null; commit("Area cleared"); requestDraw(); }
export function dropSelection() { clearSelection(); requestDraw(); }
