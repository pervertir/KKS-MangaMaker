import { api, deep, post } from "../editor/core.js";
import { addImageLayer, addLayer, createAt, insertIndexForPanel, setPanelImage } from "../editor/creation.js";
import { drawLayer } from "../editor/drawing.js";
import { commit, snapshot } from "../editor/history.js";
import { hitLayer } from "../editor/hit.js";
import { pollJobs, toggleJobs } from "../editor/jobs.js";
import { refreshPanels, toast } from "../editor/misc.js";
import { H, S, W, layers, selL } from "../editor/state.ts";
import { requestDraw } from "../editor/view.js";
import type { Layer } from "../types.ts";
import { ui } from "../ui/store.svelte.ts";

export type AssetKind = "background" | "prop" | "expression" | "tone" | "balloon" | "effect" | "sfx" | "group";

export type AssetPayload =
  | { type: "image"; ref: string; w: number; h: number; multiply: boolean }
  | { type: "bubble"; key: string }
  | { type: "layers"; layers: Layer[]; w: number; h: number };

export interface LibAsset {
  id: string;
  kind: AssetKind;
  name: string;
  tags: string[];
  character: string;
  thumb: string | null;
  payload: AssetPayload;
  source: { shot?: string; from?: string };
  created: number;
}

/** What /api/library answers, and what the Assets tab draws from. */
export const lib: { kinds: AssetKind[]; characters: string[]; assets: LibAsset[]; loaded: boolean } =
  { kinds: [], characters: [], assets: [], loaded: false };

export const KIND_LABEL: Record<AssetKind, string> = {
  background: "Backgrounds", prop: "Props", expression: "Expressions", tone: "Tones", balloon: "Balloons",
  effect: "Effects", sfx: "SFX", group: "Groups",
};

export async function loadLibrary() {
  try { Object.assign(lib, await api("/api/library"), { loaded: true }); }
  catch (e) { toast((e as Error).message, "err"); }
  ui.rev++;
}

export function matches(a: LibAsset, q: string, kind: string, character: string): boolean {
  if (kind && a.kind !== kind) return false;
  if (character && a.character !== character) return false;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [a.name, a.kind, a.character, ...a.tags].join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
}

/* ------------------------------------------------------------------ placing */
type Pt = { x: number; y: number };

/** A background, or a face variant made from a render, fills the panel it is dropped on; everything
    else lands on the page as a layer centred where it was dropped (or on the page). */
export function placeAsset(a: LibAsset, at: Pt | null = null) {
  const panel = at ? (hitLayer as (p: Pt, f: (l: Layer) => boolean) => Layer | null)(at, l => l.type === "panel") : null;
  const p = a.payload;
  if (p.type === "image") {
    const fills = a.kind === "background" || (a.kind === "expression" && !!a.source?.shot);
    const target = panel || (fills && selL()?.type === "panel" ? selL() : null);
    if (fills && target) { S.sel = target.id; setPanelImage(target, p.ref, a.source?.shot || target.shot || ""); return; }
    addImageLayer(p.ref, p.w || 600, p.h || 600, at, p.multiply).name = a.name;
    snapshot();
  } else if (p.type === "bubble") {
    S.bubble = p.key;
    const c = at || { x: W() / 2, y: H() / 2 };
    createAt("bubble", { x: c.x, y: c.y, w: 0, h: 0 }, true);
  } else insertLayers(a, p, at, panel);
  refreshPanels();
}

function insertLayers(a: LibAsset, p: { layers: Layer[]; w: number; h: number }, at: Pt | null, panel: Layer | null) {
  const c = at || { x: W() / 2, y: H() / 2 };
  const dx = c.x - p.w / 2, dy = c.y - p.h / 2;
  const ids = new Map<string, string>();
  const made: Layer[] = [];
  for (const src of p.layers) {
    const l = deep(src) as Layer, old = l.id;
    l.x += dx; l.y += dy;
    addLayer(l, l.type === "panel" ? insertIndexForPanel() : undefined);
    if (old) ids.set(old, l.id);
    made.push(l);
  }
  for (const l of made) if (l.clip) l.clip = ids.get(l.clip) || panel?.id || null;
  if (!made.length) return;
  S.sel = made[made.length - 1].id;
  commit(`Added ${a.name}`); requestDraw();
}

/* ------------------------------------------------------------------- saving */
const TEXTY = ["bubble", "caption", "text", "vbubble"];
const inside = (q: Layer, p: Layer) => { const cx = q.x + q.w / 2, cy = q.y + q.h / 2; return cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h; };

/** The selected layer, or a panel with everything drawn over it (lettering, tones, images inside its frame). */
export function selectionLayers(): Layer[] {
  const l = selL(); if (!l) return [];
  if (l.type !== "panel") return [l];
  const ls = layers(), i = ls.indexOf(l);
  return [l, ...ls.slice(i + 1).filter(q => q.type !== "panel" && (q.clip === l.id || inside(q, l)))];
}

export function guessKind(ls: Layer[]): AssetKind {
  if (ls.length > 1 || ls[0].type === "panel") return "group";
  const l = ls[0];
  if (l.type === "tone") return "tone";
  if (l.type === "speed") return "effect";
  if (l.type === "text" && l.sfx) return "sfx";
  if (TEXTY.includes(l.type)) return "balloon";
  return "prop";
}

/** A small PNG of the layers, drawn the way the page draws them. */
export function layersThumb(ls: Layer[], size = 320): string {
  const x0 = Math.min(...ls.map(l => l.x)), y0 = Math.min(...ls.map(l => l.y));
  const w = Math.max(...ls.map(l => l.x + l.w)) - x0, h = Math.max(...ls.map(l => l.y + l.h)) - y0;
  const k = size / Math.max(w, h, 1);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  const ctx = cv.getContext("2d")!;
  ctx.scale(k, k); ctx.translate(-x0, -y0);
  for (const l of ls) drawLayer(ctx, l, { theme: "light", rs: k });
  return cv.toDataURL("image/png");
}

export interface SaveRequest {
  kind: AssetKind; name: string; tags: string; character: string;
  ref?: string; multiply?: boolean; layers?: Layer[]; thumb?: string; source?: Record<string, string>;
}

export async function saveAsset(req: SaveRequest): Promise<LibAsset | null> {
  try {
    const a = await post("/api/library", req) as LibAsset;
    lib.assets.unshift(a);
    if (a.character && !lib.characters.includes(a.character)) lib.characters = [...lib.characters, a.character].sort();
    ui.rev++;
    toast(`Saved "${a.name}" to the asset library`, "ok");
    return a;
  } catch (e) { toast((e as Error).message, "err"); return null; }
}

/** What "Save to asset library" starts from for the current selection. */
export function draftFromSelection(): SaveRequest | null {
  const ls = selectionLayers();
  if (!ls.length) return null;
  const l = ls[0];
  if (ls.length === 1 && l.type === "image")
    return { kind: "prop", name: l.name || (String(l.ref).startsWith("lib:") ? "Image" : String(l.ref).split("/").pop()!.replace(/\.\w+$/, "")), tags: "", character: "", ref: l.ref, multiply: l.blend === "multiply" };
  return { kind: guessKind(ls), name: l.name || (l.type === "panel" ? "Panel" : String(l.text || l.type).slice(0, 40)), tags: "", character: "",
    layers: deep(ls), thumb: layersThumb(ls) };
}

export function draftFromRender(ref: string, shot = ""): SaveRequest {
  return { kind: "background", name: shot || ref.split("/").pop()!.replace(/\.\w+$/, ""), tags: "", character: "", ref, source: shot ? { shot } : undefined };
}

export async function updateAsset(a: LibAsset, fields: Partial<Pick<LibAsset, "name" | "tags" | "kind" | "character">>) {
  try { Object.assign(a, await post(`/api/library/item/${encodeURIComponent(a.id)}`, fields)); ui.rev++; }
  catch (e) { toast((e as Error).message, "err"); }
}

export async function removeAsset(a: LibAsset) {
  try {
    await post(`/api/library/item/${encodeURIComponent(a.id)}/delete`);
    lib.assets = lib.assets.filter(q => q.id !== a.id); ui.rev++;
    toast(`Removed "${a.name}" from the library (pages that use it keep their copy)`);
  } catch (e) { toast((e as Error).message, "err"); }
}

export async function uploadAssets(files: FileList | File[], kind: AssetKind) {
  for (const f of files) {
    try {
      const a = await post(`/api/library/upload?name=${encodeURIComponent(f.name)}&kind=${kind}`, f, true) as LibAsset;
      lib.assets.unshift(a);
    } catch (e) { toast(`${f.name}: ${(e as Error).message}`, "err"); }
  }
  ui.rev++;
}

/* --------------------------------------------------------------- expressions */
export async function newExpression(shot: string, ref: string, character: number, tags: string) {
  if (S.pod && !S.pod.running) toast("The pod isn't running: Pipeline › Start pod first", "err");
  try {
    const r = await post("/api/library/expression", { shot, ref, character, tags });
    S.jobs[r.id] = { id: r.id, label: `expression ${shot}: ${tags}`, lines: [], next: 0, done: false, body: { cmd: "expression", shot },
      after: (code: number) => { if (code === 0) loadLibrary(); } };
    S.jobView = r.id; toggleJobs(true); pollJobs();
  } catch (e) { toast((e as Error).message, "err"); }
}

