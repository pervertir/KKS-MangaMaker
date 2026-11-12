import { api, h } from "./core.js";
import { addLayer } from "./creation.js";
import { imageRect } from "./drawing.js";
import { commit } from "./history.js";
import { refreshPanels, status, toast } from "./misc.js";
import { renderOptions } from "./options.js";
import { S, layers, selL } from "./state.ts";
import { requestDraw } from "./view.js";
import { defineLayerType } from "../core/registry.ts";
import { registerTool, type ToolEvent } from "../core/tools.ts";
import type { Layer } from "../types.ts";

/* Rulers: perspective (vanishing points plus families of parallel lines), parallel, concentric, radial
   and symmetry guides. Each is a "ruler" layer covering a panel (clip = the panel, so it follows it) or
   the page. They draw on screen only and never export; clicks pass through them to what is below.
   Points are kept as fractions of the layer's box, so moving or resizing the panel carries them along.
   rulerStroke() is what drawing tools ask to lock a stroke to them. */

export type Pt = { x: number; y: number };
export type RulerKind = "p1" | "p2" | "p3" | "parallel" | "concentric" | "radial" | "symmetry";
export interface RulerLayer extends Layer {
  type: "ruler";
  kind: RulerKind;
  /** vanishing points, as fractions of the box (may lie far outside it) */
  vps: [number, number][];
  /** families of parallel lines (screen angle, degrees) */
  dirs: number[];
  /** centre of a parallel, concentric, radial or symmetry ruler, as a fraction of the box */
  c?: [number, number];
  angle?: number;
  snap: boolean;
  /** the shot whose 3D camera it came from */
  from3d?: string;
}

export const RULER_KINDS: [RulerKind, string, string][] = [
  ["p1", "1-point", "One vanishing point on the horizon, plus level and upright lines"],
  ["p2", "2-point", "Two vanishing points on the horizon, plus upright lines"],
  ["p3", "3-point", "Two vanishing points on the horizon and one above or below"],
  ["parallel", "Parallel", "Lines at one angle"],
  ["concentric", "Concentric", "Circles around a centre (focus effects)"],
  ["radial", "Radial", "Lines through a centre"],
  ["symmetry", "Symmetry", "A mirror axis"],
];
const VP_COLORS = ["#ff4f7b", "#3ccf8e", "#4c8dff"], GUIDE = "#18b4ff", HORIZON = "#f5b84b", AXIS = "#c86bff";

export const isRuler = (l: Layer | null | undefined): l is RulerLayer => l?.type === "ruler";
export const isPersp = (r: RulerLayer) => r.kind === "p1" || r.kind === "p2" || r.kind === "p3";
export const rulers = (): RulerLayer[] => layers().filter(isRuler);
const toPg = (r: RulerLayer, [u, v]: [number, number]): Pt => ({ x: r.x + u * r.w, y: r.y + v * r.h });
const toFr = (r: RulerLayer, p: Pt): [number, number] => [+((p.x - r.x) / r.w).toFixed(5), +((p.y - r.y) / r.h).toFixed(5)];
const inBox = (r: RulerLayer, p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const kindName = (k: RulerKind) => RULER_KINDS.find(q => q[0] === k)![1];

/* ---------------------------------------------------------------- the layer type */
function raysFrom(g: CanvasRenderingContext2D, o: Pt, r: RulerLayer, n: number) {
  const cs = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  const far = Math.hypot(r.w, r.h) * 4 + Math.hypot(o.x - r.x, o.y - r.y);
  let lo = 0, hi = Math.PI * 2;
  if (!inBox(r, o)) {
    const mid = Math.atan2(r.y + r.h / 2 - o.y, r.x + r.w / 2 - o.x);
    const rel = cs.map(([x, y]) => { const t = Math.atan2(y - o.y, x - o.x); return Math.atan2(Math.sin(t - mid), Math.cos(t - mid)); });
    lo = mid + Math.min(...rel); hi = mid + Math.max(...rel);
  }
  for (let i = 0; i <= n; i++) { const t = lo + (hi - lo) * i / n; g.moveTo(o.x, o.y); g.lineTo(o.x + Math.cos(t) * far, o.y + Math.sin(t) * far); }
}
function parallels(g: CanvasRenderingContext2D, deg: number, r: RulerLayer, step: number, through?: Pt) {
  const t = deg * Math.PI / 180, dx = Math.cos(t), dy = Math.sin(t), nx = -dy, ny = dx;
  const cx = through?.x ?? r.x + r.w / 2, cy = through?.y ?? r.y + r.h / 2;
  const R = Math.hypot(r.w, r.h) + Math.hypot(cx - r.x - r.w / 2, cy - r.y - r.h / 2), n = Math.ceil(R / step);
  for (let s = -n; s <= n; s++) { const ox = cx + nx * s * step, oy = cy + ny * s * step; g.moveTo(ox - dx * R, oy - dy * R); g.lineTo(ox + dx * R, oy + dy * R); }
}
function line(g: CanvasRenderingContext2D, p: Pt, ang: number) {
  const R = 1e5; g.moveTo(p.x - Math.cos(ang) * R, p.y - Math.sin(ang) * R); g.lineTo(p.x + Math.cos(ang) * R, p.y + Math.sin(ang) * R);
}
function drawRuler(g: CanvasRenderingContext2D, r: RulerLayer, opt: { rs?: number }) {
  if (S.showRulers === false || (opt.rs || 1) < 0.12) return;        // not in page-strip thumbnails
  const px = (devicePixelRatio || 1) / Math.max(0.02, opt.rs || 1), sel = r.id === S.sel && S.tool === "ruler";
  const step = Math.max(r.w, r.h) / 14;
  g.save();
  g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
  g.lineWidth = px; g.globalAlpha *= sel ? 0.55 : 0.3;
  if (isPersp(r)) {
    r.vps.forEach((v, i) => { g.beginPath(); g.strokeStyle = VP_COLORS[i % 3]; raysFrom(g, toPg(r, v), r, 22); g.stroke(); });
    g.strokeStyle = GUIDE;
    for (const d of r.dirs) { g.beginPath(); parallels(g, d, r, step); g.stroke(); }
    const vp = r.vps.map(v => toPg(r, v));
    if (vp.length) {
      g.globalAlpha = sel ? 0.9 : 0.6; g.strokeStyle = HORIZON; g.lineWidth = 1.5 * px; g.beginPath();
      line(g, vp[0], vp.length >= 2 ? Math.atan2(vp[1].y - vp[0].y, vp[1].x - vp[0].x) : 0); g.stroke();
    }
  } else if (r.c) {
    const c = toPg(r, r.c);
    g.strokeStyle = GUIDE; g.beginPath();
    if (r.kind === "parallel") parallels(g, r.angle || 0, r, step / 1.5, c);
    if (r.kind === "radial") raysFrom(g, c, r, 48);
    if (r.kind === "concentric") {
      const R = Math.hypot(r.w, r.h) + Math.hypot(c.x - r.x, c.y - r.y);
      for (let k = step / 1.5; k < R; k += step / 1.5) { g.moveTo(c.x + k, c.y); g.arc(c.x, c.y, k, 0, Math.PI * 2); }
    }
    if (r.kind === "symmetry") { g.globalAlpha = sel ? 0.9 : 0.7; g.strokeStyle = AXIS; g.lineWidth = 2 * px; g.setLineDash([10 * px, 6 * px]); line(g, c, (r.angle ?? 90) * Math.PI / 180); }
    g.stroke();
  }
  g.restore();
}
defineLayerType<RulerLayer>({
  type: "ruler", label: "Ruler", printable: false,
  defaults(l) { l.kind ||= "p2"; l.vps ||= []; l.dirs ||= []; l.snap ??= true; l.locked ??= false; },
  draw: drawRuler,
  hit: () => false,
});

/* ---------------------------------------------------------------- creation */
function areaAt(p: Pt): { box: { x: number; y: number; w: number; h: number }; panel: string | null } {
  const ls = layers();
  for (let i = ls.length - 1; i >= 0; i--) {
    const l = ls[i];
    if (l.type === "panel" && l.visible && p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h) return { box: { x: l.x, y: l.y, w: l.w, h: l.h }, panel: l.id };
  }
  return { box: { x: 0, y: 0, w: S.doc!.width, h: S.doc!.height }, panel: null };
}
/* default points for a kind, as fractions of the box; `at` is where it was clicked */
function seed(kind: RulerKind, at: [number, number]): Partial<RulerLayer> {
  if (kind === "p1") return { vps: [[at[0], 0.4]], dirs: [0, 90] };
  if (kind === "p2") return { vps: [[-0.6, 0.4], [1.6, 0.4]], dirs: [90] };
  if (kind === "p3") return { vps: [[-0.6, 0.4], [1.6, 0.4], [0.5, 2.6]], dirs: [] };
  return { vps: [], dirs: [], c: at, angle: kind === "symmetry" ? 90 : 0 };
}
export function addRuler(kind: RulerKind, p: Pt, extra: Partial<RulerLayer> = {}, msg?: string): RulerLayer {
  const { box, panel } = extra.clip !== undefined ? { box: { x: extra.x!, y: extra.y!, w: extra.w!, h: extra.h! }, panel: extra.clip } : areaAt(p);
  const at: [number, number] = [+((p.x - box.x) / box.w).toFixed(4), +((p.y - box.y) / box.h).toFixed(4)];
  const r = addLayer({ type: "ruler", kind, name: `Ruler · ${kindName(kind)}`, ...box, clip: panel, snap: true, ...seed(kind, at), ...extra }) as RulerLayer;
  S.showRulers = true;
  commit(msg || `${kindName(kind)} ruler added`); refreshPanels(); requestDraw(); renderOptions();
  return r;
}
export function deleteRuler(r = selL()) {
  if (!isRuler(r)) return;
  const ls = layers(); ls.splice(ls.indexOf(r), 1);
  S.sel = null; commit("Ruler removed"); refreshPanels(); requestDraw(); renderOptions();
}

/* ---------------------------------------------------------------- 3D camera -> ruler */
/* A shot posed over a 3D background keeps its vanishing points as fractions of the picture (bg3d.vps,
   null where an axis is parallel to the picture, its screen angle then in bg3d.dirs). Placed through
   the panel's crop they give a perspective ruler that matches the render. */
export async function rulerFromScene(l: Layer | null) {
  if (!l || l.type !== "panel" || !l.shot) return toast("Select a panel that has a shot", "err");
  let sc: any = null;
  try { sc = await api(`/api/pose/scene?name=${encodeURIComponent(l.shot)}`); } catch { /* no scene */ }
  const b = sc?.bg3d;
  if (!b?.vps) return toast(`Shot ${l.shot} was not posed over a 3D background`, "err");
  const im = l.image ? imageRect(l, null) : { x: l.x, y: l.y, w: l.w, h: l.h }, flip = !!l.image?.flip;
  const vps = (b.vps as ([number, number] | null)[]).filter(Boolean).map(v => {
    const p = { x: im.x + (flip ? 1 - v![0] : v![0]) * im.w, y: im.y + v![1] * im.h };
    return [+((p.x - l.x) / l.w).toFixed(5), +((p.y - l.y) / l.h).toFixed(5)] as [number, number];
  });
  const dirs = ((b.dirs || []) as number[]).map(a => flip ? 180 - a : a);
  for (const q of rulers().filter(q => q.clip === l.id && q.from3d)) layers().splice(layers().indexOf(q), 1);
  const kind: RulerKind = vps.length >= 3 ? "p3" : vps.length === 2 ? "p2" : "p1";
  addRuler(kind, { x: l.x, y: l.y }, { x: l.x, y: l.y, w: l.w, h: l.h, clip: l.id, vps, dirs, from3d: l.shot, name: `Ruler · 3D camera of ${l.shot}` },
    `Ruler from the 3D camera of ${l.shot}`);
}

/* ---------------------------------------------------------------- snapping */
export type SnapLine = { o: Pt; d: Pt };
export type SnapCircle = { c: Pt; r: number };
const unit = (x: number, y: number): Pt => { const n = Math.hypot(x, y) || 1; return { x: x / n, y: y / n }; };
const dirOf = (deg: number) => unit(Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180));
/* The guides a stroke starting at p0 may follow: through p0 toward each vanishing point or centre, along
   each family of parallels, or round a concentric ruler's centre. Only rulers whose box holds p0 count. */
export function snapCandidates(p0: Pt): { lines: SnapLine[]; circles: SnapCircle[] } {
  const lines: SnapLine[] = [], circles: SnapCircle[] = [];
  if (S.showRulers === false) return { lines, circles };
  for (const r of rulers()) {
    if (!r.visible || !r.snap || !inBox(r, p0)) continue;
    if (isPersp(r)) {
      for (const v of r.vps.map(q => toPg(r, q))) if (Math.hypot(v.x - p0.x, v.y - p0.y) > 1) lines.push({ o: p0, d: unit(v.x - p0.x, v.y - p0.y) });
      for (const a of r.dirs) lines.push({ o: p0, d: dirOf(a) });
    } else if (r.c) {
      const c = toPg(r, r.c);
      if (r.kind === "parallel") lines.push({ o: p0, d: dirOf(r.angle || 0) });
      if (r.kind === "radial" && Math.hypot(c.x - p0.x, c.y - p0.y) > 1) lines.push({ o: p0, d: unit(c.x - p0.x, c.y - p0.y) });
      if (r.kind === "concentric") circles.push({ c, r: Math.hypot(p0.x - c.x, p0.y - c.y) });
    }
  }
  return { lines, circles };
}
const onLine = (L: SnapLine, p: Pt): Pt => { const t = (p.x - L.o.x) * L.d.x + (p.y - L.o.y) * L.d.y; return { x: L.o.x + L.d.x * t, y: L.o.y + L.d.y * t }; };
const onCircle = (C: SnapCircle, p: Pt): Pt => { const u = unit(p.x - C.c.x, p.y - C.c.y); return { x: C.c.x + u.x * C.r, y: C.c.y + u.y * C.r }; };
function closest(p0: Pt, p: Pt, lines: SnapLine[], circles: SnapCircle[]): { line?: SnapLine; circle?: SnapCircle } | null {
  const dir = unit(p.x - p0.x, p.y - p0.y);
  let best = Infinity, out: { line?: SnapLine; circle?: SnapCircle } | null = null;
  for (const L of lines) { const s = 1 - Math.abs(L.d.x * dir.x + L.d.y * dir.y); if (s < best) { best = s; out = { line: L }; } }
  for (const C of circles) { const rad = unit(p0.x - C.c.x, p0.y - C.c.y), s = Math.abs(rad.x * dir.x + rad.y * dir.y); if (s < best) { best = s; out = { circle: C }; } }
  return out;
}
/* One stroke: once the pointer is a few screen pixels from the start, lock to the guide nearest the way
   it went and keep every later point on it. snap(p) gives the point to draw; mirrored(p) its copies
   across each symmetry ruler the stroke started in; lock says what it is locked to (for an overlay). */
export function rulerStroke(p0: Pt) {
  const { lines, circles } = snapCandidates(p0);
  const mirrors = rulers().filter(r => r.visible && r.kind === "symmetry" && r.snap && r.c && inBox(r, p0));
  const lock: { line?: SnapLine; circle?: SnapCircle } = {};
  const active = lines.length + circles.length > 0;
  return {
    lock, active,
    snap(p: Pt): Pt {
      if (lock.line) return onLine(lock.line, p);
      if (lock.circle) return onCircle(lock.circle, p);
      if (!active || Math.hypot(p.x - p0.x, p.y - p0.y) < 8 / S.view.s) return p;
      Object.assign(lock, closest(p0, p, lines, circles));
      return lock.line ? onLine(lock.line, p) : lock.circle ? onCircle(lock.circle, p) : p;
    },
    mirrored(p: Pt): Pt[] {
      return mirrors.map(r => {
        const d = dirOf(r.angle ?? 90), c = toPg(r, r.c!), q = { x: p.x - c.x, y: p.y - c.y }, k = q.x * d.x + q.y * d.y;
        return { x: c.x + 2 * k * d.x - q.x, y: c.y + 2 * k * d.y - q.y };
      });
    },
  };
}
/* Stateless form for a snapping service: the point on the nearest-angle guide from ctx.start, or null. */
export function rulerSnap(pt: Pt, ctx: { start?: Pt } = {}): (Pt & { guide: SnapLine | SnapCircle }) | null {
  const p0 = ctx.start; if (!p0 || Math.hypot(pt.x - p0.x, pt.y - p0.y) < 1) return null;
  const { lines, circles } = snapCandidates(p0), c = closest(p0, pt, lines, circles);
  if (!c) return null;
  return c.line ? { ...onLine(c.line, pt), guide: c.line } : { ...onCircle(c.circle!, pt), guide: c.circle! };
}

/* ---------------------------------------------------------------- the Ruler tool */
type HandleKey = string;   // vp0, vp1, vp2, c, angle
const handleKeys = (r: RulerLayer): HandleKey[] => isPersp(r) ? r.vps.map((_, i) => "vp" + i)
  : r.kind === "parallel" || r.kind === "symmetry" ? ["c", "angle"] : ["c"];
function handlePos(r: RulerLayer, k: HandleKey): Pt {
  if (k.startsWith("vp")) return toPg(r, r.vps[+k.slice(2)]);
  const c = toPg(r, r.c || [0.5, 0.5]);
  if (k === "angle") { const t = (r.angle ?? 0) * Math.PI / 180, L = 70 / S.view.s; return { x: c.x + Math.cos(t) * L, y: c.y + Math.sin(t) * L }; }
  return c;
}
function hitHandle(p: Pt): { r: RulerLayer; k: HandleKey } | null {
  const tol = 11 / S.view.s, list = rulers().filter(r => r.visible && !r.locked).sort((a, b) => +(b.id === S.sel) - +(a.id === S.sel));
  for (const r of list) for (const k of handleKeys(r)) { const q = handlePos(r, k); if (Math.hypot(q.x - p.x, q.y - p.y) < tol) return { r, k }; }
  return null;
}
let drag: { r: RulerLayer; k: HandleKey; before: string } | null = null;
function moveHandle(r: RulerLayer, k: HandleKey, p: Pt, shift: boolean) {
  if (k.startsWith("vp")) {
    const i = +k.slice(2); r.vps[i] = toFr(r, p);
    if (!shift && (r.kind === "p2" || r.kind === "p3") && i < 2) r.vps[1 - i] = [r.vps[1 - i][0], r.vps[i][1]];   // the horizon stays level unless Shift
  } else if (k === "c") r.c = toFr(r, p);
  else if (k === "angle") {
    const c = toPg(r, r.c || [0.5, 0.5]);
    let a = Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI; if (shift) a = Math.round(a / 15) * 15;
    r.angle = +a.toFixed(1);
  }
  r.rev = (r.rev || 0) + 1; requestDraw();
}
function select(r: RulerLayer) { if (S.sel !== r.id) { S.sel = r.id; refreshPanels(); renderOptions(); } requestDraw(); }

export const RULER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 9h20M12 9L3 21M12 9l9 12M12 9v12"/><circle cx="12" cy="9" r="2" fill="currentColor"/></svg>';
registerTool({
  id: "ruler", label: "Rulers: perspective, parallel, concentric, radial, symmetry", key: "u", icon: RULER_ICON, group: "guides", cursor: "pointer",
  activate() { if (S.showRulers === false) S.showRulers = true; requestDraw(); },
  deactivate() { requestDraw(); },
  down(e: ToolEvent) {
    const p = { x: e.raw.x, y: e.raw.y }, hit = hitHandle(p);
    if (hit) { select(hit.r); drag = { ...hit, before: JSON.stringify(hit.r) }; return; }
    const inside = rulers().filter(r => r.visible && inBox(r, p));
    if (inside.length && !e.alt) {
      const i = inside.findIndex(r => r.id === S.sel), next = inside[(i + 1) % inside.length];  // clicking again cycles overlapping rulers
      select(next); status("Drag a coloured dot: a vanishing point, a centre or an angle. Shift tilts the horizon. Alt-click adds another ruler.");
      return;
    }
    addRuler((S.rulerKind || "p2") as RulerKind, p);
  },
  move(e: ToolEvent) { if (drag) moveHandle(drag.r, drag.k, { x: e.raw.x, y: e.raw.y }, e.shift); },
  up() { if (drag && JSON.stringify(drag.r) !== drag.before) commit("Ruler adjusted"); drag = null; },
  cancel() { if (drag) { Object.assign(drag.r, JSON.parse(drag.before)); drag = null; requestDraw(); } },
  keydown(e: KeyboardEvent) {
    if ((e.key === "Delete" || e.key === "Backspace") && isRuler(selL())) { deleteRuler(); return true; }
    return false;
  },
  overlay(g: CanvasRenderingContext2D, px: number) {
    if (S.showRulers === false) return;
    for (const r of rulers()) {
      if (!r.visible) continue;
      const sel = r.id === S.sel;
      g.save();
      g.lineWidth = 1.5 * px; g.strokeStyle = sel ? "#4c8dff" : "#ffffff66"; g.setLineDash([8 * px, 6 * px]);
      g.strokeRect(r.x, r.y, r.w, r.h); g.setLineDash([]);
      for (const k of handleKeys(r)) {
        const q = handlePos(r, k), rad = (k === "angle" ? 6 : sel ? 10 : 8) * px;
        if (k === "angle") { const c = handlePos(r, "c"); g.strokeStyle = AXIS; g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(q.x, q.y); g.stroke(); }
        g.fillStyle = k.startsWith("vp") ? VP_COLORS[+k.slice(2) % 3] : k === "angle" ? AXIS : GUIDE;
        g.beginPath(); g.arc(q.x, q.y, rad, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#fff"; g.stroke();
        if (k.startsWith("vp")) { g.fillStyle = "#fff"; g.font = `700 ${11 * px}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(+k.slice(2) + 1), q.x, q.y + 0.5 * px); }
      }
      g.restore();
    }
  },
  options(bar: HTMLElement) {
    const r = selL(), pl = r && r.type === "panel" ? r : null;
    bar.append(h("select", { title: "Kind of ruler a click adds", onchange: (e: Event) => { S.rulerKind = (e.target as HTMLSelectElement).value; } },
      ...RULER_KINDS.map(([k, t, tip]) => h("option", { value: k, title: tip, selected: (S.rulerKind || "p2") === k }, t))));
    bar.append(h("button", { disabled: !pl?.shot, title: "A perspective ruler matching the 3D camera the selected panel's shot was posed with",
      onclick: () => rulerFromScene(pl) }, "From 3D camera"));
    if (isRuler(r)) bar.append(
      h("label", { class: "chk", title: "Strokes started inside this ruler follow it" },
        h("input", { type: "checkbox", checked: r.snap, onchange: (e: Event) => { r.snap = (e.target as HTMLInputElement).checked; commit(r.snap ? "Ruler snaps" : "Ruler does not snap"); } }), " Snap"),
      h("button", { class: "ghost danger", title: "Delete this ruler (Del)", onclick: () => deleteRuler(r) }, "Delete"));
    bar.append(h("button", { class: "ghost", title: "Show or hide every ruler. Rulers never print or export.",
      onclick: () => { S.showRulers = S.showRulers === false; renderOptions(); requestDraw(); } }, S.showRulers === false ? "Show rulers" : "Hide rulers"));
  },
});
