import { canvas } from "./blobs.ts";
import { Stamper, pathLength, type Sample } from "./brush.ts";
import { regionAt } from "./fill.ts";
import { isPaint, loadTiles, mergeInto, pageScale, toLocal } from "./raster.ts";
import { LIVE } from "./render.ts";
import { DS, curBrush, curInk } from "./settings.ts";
import { encode, eraseAt, type Item, type StrokeItem } from "./vector.ts";
import { intersect, isEmpty, toSvg, trace, bounds, type Region } from "../core/geometry/region.ts";
import type { Sample as InSample } from "../core/input.ts";
import { hasSelection, selection, selectionPage } from "../core/selection.ts";
import type { ToolEvent } from "../core/tools.ts";
import { addLayer } from "../editor/creation.js";
import { commit } from "../editor/history.js";
import { waitImages } from "../editor/images.js";
import { drawPage } from "../editor/manga-tools.js";
import { refreshPanels, status, toast } from "../editor/misc.js";
import { H, S, W, layers, page, selL } from "../editor/state.ts";
import { requestDraw, requestView, set_DC } from "../editor/view.js";
import type { Layer } from "../types.ts";

type P = { x: number; y: number };

/* ---------------------------------------------------------------- which layer a tool paints on */
function panelAt(p: P): Layer | null {
  const ls = layers();
  for (let i = ls.length - 1; i >= 0; i--) {
    const l = ls[i];
    if (l.type === "panel" && l.visible && p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h) return l;
  }
  return null;
}
/* The selected layer when it is the right kind; else the top one of that kind in the panel under the pen;
   else a new one, clipped to that panel and stacked with the panel's own tones and lines. */
export function target(kind: "raster" | "vector", p: P): Layer {
  const s = selL();
  if (s?.type === kind) return s;
  const panel = panelAt(p), pid = panel?.id || null, ls = layers();
  const mine = ls.filter(l => l.type === kind && l.visible && !l.locked && (l.clip || null) === pid);
  if (mine.length) { S.sel = mine[mine.length - 1].id; refreshPanels(); return mine[mine.length - 1]; }
  const box = panel ? { x: panel.x, y: panel.y, w: panel.w, h: panel.h } : { x: 0, y: 0, w: W(), h: H() };
  let at: number | undefined;
  if (panel) {
    at = ls.indexOf(panel) + 1;
    ls.forEach((l, i) => { if (l.clip === pid && !["bubble", "vbubble", "caption", "text"].includes(l.type)) at = Math.max(at!, i + 1); });
  }
  // paint gets up to twice the page's pixels so it stays crisp when zoomed and exported; a canvas this size must stay under Safari's 16.7 MP
  const res = kind === "raster" ? Math.min(2, Math.sqrt(16e6 / (box.w * box.h))) : 1;
  const l = addLayer({ type: kind, ...box, ow: Math.round(box.w * res), oh: Math.round(box.h * res), clip: pid, rotate: 0 }, at);
  refreshPanels();
  return l;
}
/** the region selection, in the layer's own pixels, when there is one on this page */
function selectionIn(l: Layer): Region | null {
  if (!hasSelection() || selectionPage() !== page().id) return null;
  return selection()!.map(ring => ring.map(([x, y]) => { const q = toLocal(l, { x, y }); return [q.x, q.y] as [number, number]; }));
}

/* ---------------------------------------------------------------- strokes */
interface Stroke {
  l: Layer; kind: "brush" | "erase" | "ink" | "verase";
  samples: Sample[]; stamper?: Stamper; canvas?: HTMLCanvasElement; changed?: boolean; r?: number; mask?: Region | null; last?: { x: number; y: number };
}
let cur: Stroke | null = null;
const lastEnd = new Map<string, Sample>();
let strokeCanvas: HTMLCanvasElement | null = null;
function freshCanvas(w: number, h: number): HTMLCanvasElement {
  if (!strokeCanvas || strokeCanvas.width !== Math.ceil(w) || strokeCanvas.height !== Math.ceil(h)) strokeCanvas = canvas(w, h);
  else strokeCanvas.getContext("2d")!.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
  return strokeCanvas;
}
function local(l: Layer, s: InSample): Sample {
  const q = toLocal(l, s), pen = s.pointerType === "pen";
  return { x: q.x, y: q.y, p: pen ? Math.pow(Math.max(0.02, s.pressure), DS.curve) : 1, tx: s.tiltX, ty: s.tiltY };
}
function begin(l: Layer) {
  S.liveLayer = l; set_DC(null);
}
function end() {
  cur = null; S.liveLayer = null; set_DC(null);
}

export function strokeDown(e: ToolEvent, tool: "brush" | "eraser" | "ink") {
  const p = e.raw;
  let l: Layer | null;
  if (tool === "eraser") {
    l = selL();
    if (!isPaint(l)) { status("Select a paint or line-art layer to erase on (Layers list)"); return; }
  } else l = target(tool === "ink" ? "vector" : "raster", p);
  if (l!.locked) { toast("That layer is locked: unlock it first (⌘L)", "err"); return; }
  if (!l!.visible) { toast("That layer is hidden", "err"); return; }
  const L = l!, scale = pageScale(L);
  const kind = L.type === "vector" ? (tool === "eraser" ? "verase" : "ink") : (tool === "eraser" ? "erase" : "brush");
  cur = { l: L, kind, samples: [] };
  if (kind === "brush" || kind === "erase") {
    loadTiles(L);
    const b = kind === "erase" ? DS.eraser : curBrush();
    cur.canvas = freshCanvas(L.ow, L.oh);
    cur.mask = selectionIn(L);
    const g = cur.canvas.getContext("2d")!;
    if (cur.mask) { g.save(); g.beginPath(); trace(g, cur.mask); g.clip("evenodd"); }
    cur.stamper = new Stamper(g, b, kind === "erase" ? "#000000" : DS.color, scale);
    LIVE.cur = { layer: L.id, kind, canvas: cur.canvas, alpha: b.opacity };
  } else if (kind === "ink") {
    const k = curInk();
    LIVE.cur = { layer: L.id, kind, pts: [], style: { color: DS.color, size: k.size / scale, thinning: k.thinning, smoothing: k.smoothing,
      streamline: k.streamline, taper: k.taper.map(v => v >= 9999 ? 9999 : v / scale) as [number, number], pen: e.raw.pointerType === "pen" } };
  } else {
    cur.r = DS.eraser.size / 2 / scale;
    LIVE.cur = { layer: L.id, kind };
  }
  begin(L);
  const prev = lastEnd.get(L.id);
  if (e.shift && prev && (kind === "brush" || kind === "ink")) add(prev);
  feed(e);
  requestDraw();
}
function feed(e: ToolEvent) {
  const c = cur!;
  if (c.kind === "verase") {
    for (const s of e.samples) {
      const q = toLocal(c.l, s), a = c.last || q, n = Math.max(1, Math.ceil(Math.hypot(q.x - a.x, q.y - a.y) / Math.max(0.5, c.r! / 2)));
      for (let i = 1; i <= n; i++) if (eraseAt(c.l, a.x + (q.x - a.x) * i / n, a.y + (q.y - a.y) * i / n, c.r!, DS.verase)) c.changed = true;
      c.last = q;
    }
    return;
  }
  for (const s of e.samples) add(local(c.l, s));
}
function add(s: Sample) {
  const c = cur!;
  c.samples.push(s);
  if (c.stamper) c.stamper.add(s);
  else LIVE.cur?.pts?.push([s.x, s.y, s.p]);
}
export function strokeMove(e: ToolEvent) { if (cur) { feed(e); requestView(); } }
export function strokeCancel() { if (cur) { LIVE.cur = null; end(); requestDraw(); } }

let queue: Promise<unknown> = Promise.resolve();
export function strokeUp(e: ToolEvent) {
  const c = cur;
  if (!c) return;
  feed(e);
  const l = c.l;
  end();
  if (c.samples.length) lastEnd.set(l.id, c.samples[c.samples.length - 1]);
  if (c.kind === "verase") { LIVE.cur = null; if (c.changed) commit("Erased lines"); requestDraw(); return; }
  if (c.kind === "ink") {
    const st = LIVE.cur!.style!, pts = LIVE.cur!.pts!;
    LIVE.cur = null;
    if (pts.length) { const it: StrokeItem = { k: "s", pts: encode(pts), ...st }; l.items = [...(l.items || []), it]; commit("Inked"); }
    requestDraw(); return;
  }
  const b = c.stamper!.b;
  if (b.taper[1] > 0 && c.samples.length > 1) {          // the end taper needs the stroke's length, so lay it again
    const g = c.stamper!.g;
    g.clearRect(0, 0, c.canvas!.width, c.canvas!.height);
    const st = new Stamper(g, b, c.kind === "erase" ? "#000000" : DS.color, c.stamper!.scale, pathLength(c.samples));
    for (const s of c.samples) st.add(s);
    c.stamper = st;
  }
  if (c.mask) c.stamper!.g.restore();
  const B = c.stamper!.box;
  LIVE.cur = null;
  const x0 = Math.max(0, Math.floor(B.x0)), y0 = Math.max(0, Math.floor(B.y0));
  const x1 = Math.min(l.ow, Math.ceil(B.x1)), y1 = Math.min(l.oh, Math.ceil(B.y1));
  if (!(x1 > x0 && y1 > y0)) { requestDraw(); return; }
  const piece = canvas(x1 - x0, y1 - y0);
  piece.getContext("2d")!.drawImage(c.canvas!, -x0, -y0);
  const pend = { layer: l.id, canvas: piece, x: x0, y: y0, alpha: b.opacity, erase: c.kind === "erase" };
  LIVE.pending.push(pend);
  requestDraw();
  queue = queue.then(() => mergeInto(l, piece, x0, y0, { x0, y0, x1, y1 }, c.kind === "erase" ? "destination-out" : "source-over", b.opacity))
    .then(() => commit(c.kind === "erase" ? "Erased" : "Painted"))
    .catch(err => toast(String(err?.message || err), "err"))
    .finally(() => { LIVE.pending.splice(LIVE.pending.indexOf(pend), 1); requestDraw(); });
}

/* ---------------------------------------------------------------- fill */
export async function fillAt(p: P) {
  const s0 = selL();
  const l = target(isPaint(s0) ? s0!.type as "raster" | "vector" : "vector", p);
  if (l.locked) { toast("That layer is locked: unlock it first (⌘L)", "err"); return; }
  status("Filling…");
  const s = Math.min(1, 1600 / Math.max(W(), H()));
  const c = canvas(W() * s, H() * s), g = c.getContext("2d", { willReadFrequently: true })!;
  const paint = () => { g.setTransform(s, 0, 0, s, 0, 0); drawPage(g, page(), { export: true, rs: s }); };
  paint(); await waitImages(); paint();
  let reg: Region = regionAt(g.getImageData(0, 0, c.width, c.height), s, p.x, p.y, DS.gap, DS.tolerance);
  if (hasSelection() && selectionPage() === page().id) reg = intersect(reg, selection()!);
  if (isEmpty(reg)) { status("Nothing to fill there"); return; }
  const loc: Region = reg.map(ring => ring.map(([x, y]) => { const q = toLocal(l, { x, y }); return [q.x, q.y] as [number, number]; }));
  if (l.type === "vector") {
    const its = (l.items || []) as Item[], at = its.findIndex(it => it.k === "s");
    const f: Item = { k: "f", d: toSvg(loc), color: DS.color };
    l.items = at < 0 ? [...its, f] : [...its.slice(0, at), f, ...its.slice(at)];      // fills sit under the line art
  } else {
    const bb = bounds(loc)!, a = canvas(l.ow, l.oh), ag = a.getContext("2d")!;
    ag.fillStyle = DS.color; ag.beginPath(); trace(ag, loc); ag.fill("evenodd");
    await mergeInto(l, a, 0, 0, { x0: bb.x, y0: bb.y, x1: bb.x + bb.w, y1: bb.y + bb.h }, "source-over", 1);
  }
  commit("Filled"); requestDraw(); status("");
}
