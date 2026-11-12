/* On-canvas handles for lettering: balloon outline points and their curve handles, tail tips, the SFX
   baseline and per-glyph offsets. Coordinates are the layer's own frame (centre at 0,0, unrotated). */
import type { Layer } from "../types.ts";
import type { Pt } from "./geom.ts";
import { type Path, nearest, splitAt } from "../core/geometry/path.ts";
import { lastGlyphs } from "./sfx.ts";

export interface XHandle { key: string; x: number; y: number; kind: "anchor" | "ctrl" | "tip" | "glyph"; on?: boolean; from?: Pt }
/** Which balloon has its outline open for editing, the point picked on it and the SFX glyph picked. */
export const edit = { shape: null as string | null, node: -1, glyph: -1 };

interface Anchor { p: Pt; i?: Pt; o?: Pt }
export function anchors(path: Path): Anchor[] {
  const sp = path.subs[0], n = sp.segs.length;
  return sp.segs.map((_, k) => {
    const p = k === 0 ? sp.start : sp.segs[k - 1].p, out = sp.segs[k], inn = sp.segs[(k - 1 + n) % n];
    return { p: [...p] as Pt, ...(out.c1 ? { o: [...out.c1] as Pt } : {}), ...(inn.c2 ? { i: [...inn.c2] as Pt } : {}) };
  });
}
export function fromAnchors(as: Anchor[]): Path {
  const r = (q: Pt): Pt => [+q[0].toFixed(2), +q[1].toFixed(2)];
  return { subs: [{ start: r(as[0].p), closed: true, segs: as.map((a, k) => {
    const b = as[(k + 1) % as.length];
    return a.o || b.i ? { c1: r(a.o || a.p), c2: r(b.i || b.p), p: r(b.p) } : { p: r(b.p) };
  }) }] };
}

export function extraHandles(l: Layer): XHandle[] {
  if (!l || l.locked) return [];
  const out: XHandle[] = [];
  if (l.type === "balloon") {
    (l.tails || []).forEach((t: any, i: number) => out.push({ key: "tip:" + i, x: t.tip.x, y: t.tip.y, kind: "tip" }));
    if (edit.shape === l.id && l.path?.subs?.length) {
      anchors(l.path).forEach((a, k) => {
        if (k === edit.node) {
          if (a.i) out.push({ key: "in:" + k, x: a.i[0], y: a.i[1], kind: "ctrl", from: a.p });
          if (a.o) out.push({ key: "out:" + k, x: a.o[0], y: a.o[1], kind: "ctrl", from: a.p });
        }
        out.push({ key: "a:" + k, x: a.p[0], y: a.p[1], kind: "anchor", on: k === edit.node });
      });
    }
  }
  if (l.type === "text" && l.sfx && l.curve?.subs?.length) {
    const sp = l.curve.subs[0], s = sp.segs[0];
    if (s?.c1 && s.c2) {
      out.push({ key: "c:1", x: s.c1[0], y: s.c1[1], kind: "ctrl", from: sp.start }, { key: "c:2", x: s.c2[0], y: s.c2[1], kind: "ctrl", from: s.p });
    }
    out.push({ key: "c:0", x: sp.start[0], y: sp.start[1], kind: "anchor" });
    if (s) out.push({ key: "c:3", x: s.p[0], y: s.p[1], kind: "anchor" });
    const g = lastGlyphs(l.id);
    g?.draws.forEach((d, i) => out.push({ key: "g:" + i, x: d.x, y: d.y, kind: "glyph", on: i === edit.glyph }));
  }
  return out;
}

export function hitExtra(l: Layer, q: { x: number; y: number }, tol: number): string | null {
  const hs = extraHandles(l);
  for (let i = hs.length - 1; i >= 0; i--) if (Math.hypot(q.x - hs[i].x, q.y - hs[i].y) < tol * (hs[i].kind === "glyph" ? 0.8 : 1)) return hs[i].key;
  return null;
}

/** A press on a handle. Returns true when the press already did its job (picked or removed a point). */
export function pressHandle(l: Layer, key: string, alt: boolean): boolean {
  const [kind, n] = key.split(":"), k = +n;
  if (kind === "a") {
    if (alt) {
      const as = anchors(l.path);
      if (as.length > 3) { as.splice(k, 1); l.path = fromAnchors(as); edit.node = -1; return true; }
    }
    edit.node = k;
  }
  if (kind === "g") edit.glyph = k;
  return false;
}

export function dragHandle(l: Layer, key: string, q: { x: number; y: number }, l0: Layer, q0: { x: number; y: number }, alt: boolean): void {
  const [kind, n] = key.split(":"), k = +n, dx = q.x - q0.x, dy = q.y - q0.y;
  if (kind === "tip") { l.tails[k].tip = { x: +q.x.toFixed(1), y: +q.y.toFixed(1) }; return; }
  if (kind === "a" || kind === "in" || kind === "out") {
    const as = anchors(l0.path), a = as[k];
    if (kind === "a") {
      const mv = (p?: Pt): Pt | undefined => p && [p[0] + dx, p[1] + dy];
      as[k] = { p: mv(a.p)!, i: mv(a.i), o: mv(a.o) };
    } else {
      const mine: Pt = [q.x, q.y], other = kind === "in" ? a.o : a.i;
      if (kind === "in") a.i = mine; else a.o = mine;
      if (other && !alt) {                                   // keep the point smooth: the opposite handle turns with it
        const L = Math.hypot(other[0] - a.p[0], other[1] - a.p[1]), vx = a.p[0] - q.x, vy = a.p[1] - q.y, M = Math.hypot(vx, vy) || 1;
        const o: Pt = [a.p[0] + vx / M * L, a.p[1] + vy / M * L];
        if (kind === "in") a.o = o; else a.i = o;
      }
    }
    l.path = fromAnchors(as); return;
  }
  if (kind === "c") {
    const c = JSON.parse(JSON.stringify(l0.curve)) as Path, sp = c.subs[0], s = sp.segs[0];
    const add = (p: Pt): Pt => [+(p[0] + dx).toFixed(1), +(p[1] + dy).toFixed(1)];
    if (k === 0) { sp.start = add(sp.start); if (s.c1) s.c1 = add(s.c1); }
    if (k === 3) { s.p = add(s.p); if (s.c2) s.c2 = add(s.c2); }
    if (k === 1 && s.c1) s.c1 = add(s.c1);
    if (k === 2 && s.c2) s.c2 = add(s.c2);
    l.curve = c; return;
  }
  if (kind === "g") {
    const px = lastGlyphs(l.id)?.px || 40, gs = [...(l0.glyphs || [])];
    while (gs.length <= k) gs.push({});
    const g0 = gs[k] || {};
    gs[k] = { ...g0, dx: +((g0.dx || 0) + dx / px).toFixed(3), dy: +((g0.dy || 0) + dy / px).toFixed(3) };
    l.glyphs = gs;
  }
}

/** True when q is on the outline of the balloon being edited (a press there keeps it selected). */
export function onOutline(l: Layer, q: { x: number; y: number }, tol: number): boolean {
  if (!l || l.type !== "balloon" || edit.shape !== l.id) return false;
  const hit = nearest(l.path, q.x, q.y);
  return !!hit && hit.d <= tol;
}

/** Double-click on an open outline adds a point there. */
export function dblOutline(l: Layer, q: { x: number; y: number }, tol: number): boolean {
  if (l.type !== "balloon" || edit.shape !== l.id) return false;
  const hit = nearest(l.path, q.x, q.y);
  if (!hit || hit.d > tol) return false;
  l.path = splitAt(l.path, hit.sub, hit.seg, hit.t);
  edit.node = hit.seg + 1;
  return true;
}

export function drawHandles(ctx: CanvasRenderingContext2D, l: Layer, P: (x: number, y: number) => { x: number; y: number }, px: number): void {
  const hs = extraHandles(l);
  if (!hs.length) return;
  ctx.save();
  ctx.lineWidth = 1.2 * px;
  if (l.type === "text" && l.curve?.subs?.length) {
    const sp = l.curve.subs[0];
    ctx.strokeStyle = "rgba(76,141,255,.55)"; ctx.setLineDash([6 * px, 4 * px]); ctx.beginPath();
    const a = P(sp.start[0], sp.start[1]); ctx.moveTo(a.x, a.y);
    for (const s of sp.segs) {
      const e = P(s.p[0], s.p[1]);
      if (s.c1 && s.c2) { const b = P(s.c1[0], s.c1[1]), c = P(s.c2[0], s.c2[1]); ctx.bezierCurveTo(b.x, b.y, c.x, c.y, e.x, e.y); } else ctx.lineTo(e.x, e.y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  for (const h of hs) {
    const p = P(h.x, h.y);
    if (h.from) { const f = P(h.from[0], h.from[1]); ctx.strokeStyle = "#4c8dff"; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    ctx.beginPath();
    if (h.kind === "anchor") { const r = 5 * px; ctx.rect(p.x - r, p.y - r, r * 2, r * 2); ctx.fillStyle = h.on ? "#4c8dff" : "#fff"; ctx.strokeStyle = "#4c8dff"; }
    else if (h.kind === "ctrl") { ctx.arc(p.x, p.y, 4.5 * px, 0, 7); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#4c8dff"; }
    else if (h.kind === "tip") { ctx.arc(p.x, p.y, 7 * px, 0, 7); ctx.fillStyle = "#ff4f7b"; ctx.strokeStyle = "#fff"; }
    else { const r = 4.5 * px; ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fillStyle = h.on ? "#ff9f1c" : "rgba(255,159,28,.35)"; ctx.strokeStyle = "#fff"; }
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Resizing the box stretches what lives in its frame. */
export function scaleShapes(l: Layer, l0: Layer, sx: number, sy: number): void {
  const S = (p: Pt): Pt => [+(p[0] * sx).toFixed(2), +(p[1] * sy).toFixed(2)];
  const sc = (path: Path): Path => ({ subs: path.subs.map(sp => ({ ...sp, start: S(sp.start), segs: sp.segs.map(s => s.c1 && s.c2 ? { c1: S(s.c1), c2: S(s.c2), p: S(s.p) } : { p: S(s.p) }) })) });
  if (l0.path?.subs) l.path = sc(l0.path);
  if (l0.curve?.subs) l.curve = sc(l0.curve);
  if (Array.isArray(l0.tails)) l.tails = l0.tails.map((t: any) => ({ ...t, tip: { x: t.tip.x * sx, y: t.tip.y * sy } }));
}
