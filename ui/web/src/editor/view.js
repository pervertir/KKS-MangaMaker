import { $, clamp } from "./core.js";
import { paperOf } from "./creation.js";
import { drawLayer, imageRect } from "./drawing.js";
import { imgFor } from "./images.js";
import { placeInline } from "./inline-edit.js";
import { drawFlipped, drawPage } from "./manga-tools.js";
import { H, S, W, layers, page, selL } from "./state.js";
import { isPlainRect, panelBase, tracePanel } from "./frames.js";

/* ================================================================ canvas view */
export const cv = $("#canvas"), ctx = cv.getContext("2d"), stage = $("#stage");
/* Rendering: the page is painted once into an offscreen bitmap (PC) at screen resolution and
   blitted, so panning, zooming and overlays cost one drawImage. While a layer is dragged, the layers
   under and over it are frozen into two bitmaps and only the moving layer is painted each frame.
   Above ~4k px the cache stops growing; once the view settles the page is painted directly (sharp). */
export let drawQueued = false;
export const PC = { c: document.createElement("canvas"), cs: 0, key: "", dirty: true };
export let DC = null;  // drag cache {below, above, from, to, key}
export const MAX_CACHE = 4096;
export function requestDraw() { PC.dirty = true; if (!S.drag) DC = null; requestView(); }
export function requestView() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }
export let settleT = null;
export function interacting() { S.busy = true; clearTimeout(settleT); settleT = setTimeout(() => { S.busy = false; requestView(); }, 160); }
export function resize() {
  const r = stage.getBoundingClientRect(), d = devicePixelRatio || 1;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  if (S.needFit && S.doc) fitView();
  requestDraw();
}
export function fitView() {
  const r = stage.getBoundingClientRect(), pad = Math.min(40, r.width / 10, r.height / 10);
  if (r.width < 50 || r.height < 50) { S.needFit = true; return; }
  S.needFit = false;
  const s = Math.min((r.width - pad * 2) / W(), (r.height - pad * 2) / H());
  if (!(s > 0)) { S.needFit = true; return; }
  S.view = { s, tx: (r.width - W() * s) / 2, ty: (r.height - H() * s) / 2 };
  requestDraw(); updateZoom();
}
export function zoomAt(f, sx, sy) {
  const v = S.view, ns = clamp(v.s * f, 0.03, 8);
  v.tx = sx - (sx - v.tx) * ns / v.s; v.ty = sy - (sy - v.ty) * ns / v.s; v.s = ns;
  interacting(); requestView(); updateZoom(); placeInline();
}
export const toPage = (sx, sy) => ({ x: (sx - S.view.tx) / S.view.s, y: (sy - S.view.ty) / S.view.s });
export const toScreen = (x, y) => ({ x: x * S.view.s + S.view.tx, y: y * S.view.s + S.view.ty });
export function updateZoom() { $("#st-zoom").textContent = Math.round(S.view.s * 100) + "%"; }

export function cacheScale() { return Math.min(S.view.s * (devicePixelRatio || 1), MAX_CACHE / Math.max(W(), H())); }
export function paintCache(target, cs, from, to) {           // layers [from, to) of this page at cs device px per page px
  target.width = Math.ceil(W() * cs); target.height = Math.ceil(H() * cs);
  const g = target.getContext("2d");
  g.setTransform(cs, 0, 0, cs, 0, 0);
  if (from === 0) { g.fillStyle = paperOf(page()); g.fillRect(0, 0, W(), H()); }
  const ls = layers();
  const paper = paperOf(page());
  for (let i = from; i < to; i++) drawLayer(g, ls[i], { rs: cs, paper });
  return target;
}
export function liveRange() {                                  // contiguous layer range that moves with the drag
  const d = S.drag, ls = layers();
  const ids = new Set([d.layer.id, ...(d.kids || []).map(k => k.q.id)]);
  let a = ls.length, b = -1;
  ls.forEach((l, i) => { if (ids.has(l.id)) { a = Math.min(a, i); b = Math.max(b, i); } });
  return [a, b + 1];
}
export function draw() {
  drawQueued = false;
  if (!S.doc) return;
  if (!(S.view.s > 0) || !isFinite(S.view.tx + S.view.ty)) { S.view = { s: 0.25, tx: 0, ty: 0 }; fitView(); }
  const d = devicePixelRatio || 1, v = S.view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#151517"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(d * v.s, 0, 0, d * v.s, d * v.tx, d * v.ty);
  ctx.shadowColor = "#0009"; ctx.shadowBlur = 12 * d;
  ctx.fillStyle = paperOf(page()); ctx.fillRect(0, 0, W(), H());
  ctx.shadowBlur = 0;
  // page content clipped to the paper (bubbles may hang over panel borders, not off the page)
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W(), H()); ctx.clip();
  const ad = S.adjust && layers().find(l => l.id === S.adjust);
  const cs = cacheScale(), dragging = S.drag?.layer && !S.drag.pan;
  if (dragging) {
    const [from, to] = liveRange(), key = `${page().id}|${from}|${to}|${layers().length}|${cs}`;
    if (!DC || DC.key !== key) {
      DC = { key, from, to, below: paintCache(DC?.below || document.createElement("canvas"), cs, 0, from),
             above: paintCache(DC?.above || document.createElement("canvas"), cs, to, layers().length) };
    }
    const ls = layers();
    ctx.drawImage(DC.below, 0, 0, W(), H());
    for (let i = DC.from; i < DC.to; i++) drawLayer(ctx, ls[i], { rs: v.s * d, paper: paperOf(page()) });
    ctx.drawImage(DC.above, 0, 0, W(), H());
  } else if (!S.busy && v.s * d > cs * 1.01) {
    drawPage(ctx, page(), { rs: v.s * d });            // zoomed past the cache: paint directly once settled
  } else {
    const key = `${page().id}|${cs}`;
    if (PC.dirty || PC.key !== key) {
      if (!S.busy || !PC.key.startsWith(page().id) || PC.dirty) { paintCache(PC.c, cs, 0, layers().length); PC.key = key; PC.dirty = false; }
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(PC.c, 0, 0, W(), H());
  }
  ctx.restore();
  if (ad) { // image outside the panel, faded, so you can see what you are cropping
    const rr = ad.image && imageRect(ad), im = rr && imgFor(ad.image.ref, rr.w * v.s * d);
    if (im) {
      ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 2e5); tracePanel(ctx, ad); ctx.clip("evenodd");
      ctx.globalAlpha = 0.35; drawFlipped(ctx, im, rr, ad.image.flip); ctx.restore();
    }
    ctx.save(); ctx.setLineDash([12 / v.s, 8 / v.s]); ctx.strokeStyle = "#ff4f7b"; ctx.lineWidth = 2 / v.s;
    ctx.beginPath(); tracePanel(ctx, ad); ctx.stroke(); ctx.restore();
  }
  // overlays
  const px = 1 / v.s;
  if (S.showOrder) drawPanelOrder(px);
  if (S.showPrint) drawPrintGuides(px);
  if (S.polyDraft?.length) {
    const D = S.polyDraft, m = S.polyHover;
    ctx.save(); ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = "#4c8dff"; ctx.lineWidth = 1.5 * px;
    ctx.beginPath(); D.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); if (m) ctx.lineTo(m.x, m.y); ctx.stroke();
    ctx.setLineDash([]);
    D.forEach((q, i) => { ctx.fillStyle = i ? "#fff" : "#4c8dff"; ctx.beginPath(); ctx.arc(q.x, q.y, (i ? 5 : 7) * px, 0, 7); ctx.fill(); ctx.stroke(); });
    ctx.restore();
  }
  if (S.drag?.creating) {
    const c = S.drag.creating;
    ctx.save(); ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = "#4c8dff"; ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(c.x, c.y, c.w, c.h); ctx.restore();
  }
  for (const g of S.guides) {
    ctx.strokeStyle = "#ff3df2"; ctx.lineWidth = px; ctx.beginPath();
    if (g.x != null) { ctx.moveTo(g.x, -2000); ctx.lineTo(g.x, H() + 2000); } else { ctx.moveTo(-2000, g.y); ctx.lineTo(W() + 2000, g.y); }
    ctx.stroke();
  }
  const s = selL();
  if (s && !ad) drawSelection(s, px);
}
/* print guides on the 1800x2700 page (B5-ish tankobon at 350 dpi): trim 3 mm in from the edge (the bleed),
   safe area 5 mm inside the trim. Art that must survive the cut stays inside the green line. */
export function drawPrintGuides(px) {
  const mm = W() / 182 * 1, bleed = 3 * mm, safe = bleed + 5 * mm;
  ctx.save(); ctx.lineWidth = 1.5 * px; ctx.setLineDash([10 * px, 6 * px]);
  ctx.strokeStyle = "#ff4f7b"; ctx.strokeRect(bleed, bleed, W() - 2 * bleed, H() - 2 * bleed);
  ctx.strokeStyle = "#3ccf8e"; ctx.strokeRect(safe, safe, W() - 2 * safe, H() - 2 * safe);
  ctx.setLineDash([]); ctx.fillStyle = "#ff4f7b"; ctx.font = `${12 * px}px sans-serif`;
  ctx.fillText("trim", bleed + 4 * px, bleed - 4 * px); ctx.fillStyle = "#3ccf8e"; ctx.fillText("safe area", safe + 4 * px, safe + 14 * px);
  ctx.restore();
}
export function drawPanelOrder(px) {
  const order = panelOrder(layers());
  ctx.save();
  order.forEach((l, i) => {
    const r = 22 * px, x = l.x + 14 * px + r, y = l.y + 14 * px + r;
    ctx.globalAlpha = 0.85; ctx.fillStyle = "#ff4f7b"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.font = `700 ${22 * px}px -apple-system, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(i + 1, x, y + px);
  });
  ctx.restore();
}
export function panelOrder(ls) {  // same rule as mp.page.reading_order
  const ps = ls.filter(l => l.type === "panel" && l.visible).sort((a, b) => a.y - b.y);
  const rows = [];
  for (const p of ps) {
    const row = rows.find(r => p.y < r[0].y + Math.min(...r.map(q => q.h)) * 0.5);
    row ? row.push(p) : rows.push([p]);
  }
  const rtl = S.doc.reading !== "ltr";
  return rows.flatMap(r => r.sort((a, b) => rtl ? (b.x + b.w) - (a.x + a.w) : a.x - b.x));
}
export function corners(l) {
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2, a = (l.rotate || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const P = (dx, dy) => ({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c });
  return { P, cx, cy, a };
}
export const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
/* a polygon panel's corners are handles of their own, so its box handles stand a little outside them */
export const isPolyPanel = l => l?.type === "panel" && l.shape === "poly" && l.pts?.length >= 3 && l.pts.length <= 24;   // a curved piece (a split circle) has too many to handle
export const boxPad = (l, px) => isPolyPanel(l) ? 18 * px : 0;
export function vertexHandles(l) {
  const P = panelBase(l);
  return { P, M: P.map((p, i) => { const q = P[(i + 1) % P.length]; return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; }) };
}
export function drawSelection(l, px) {
  const pad = boxPad(l, px), { P } = corners(l), hw = l.w / 2 + pad, hh = l.h / 2 + pad;
  const pts = [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
  ctx.save();
  ctx.strokeStyle = l.locked ? "#f5b84b" : "#4c8dff"; ctx.lineWidth = 1.5 * px;
  if (l.type === "panel" && !isPlainRect(l)) { ctx.beginPath(); tracePanel(ctx, l); ctx.stroke(); ctx.setLineDash([6 * px, 5 * px]); }
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  if (!l.locked && isPolyPanel(l)) {
    const { P: V, M } = vertexHandles(l);
    for (const m of M) { ctx.fillStyle = "#4c8dff88"; ctx.beginPath(); ctx.arc(m.x, m.y, 4 * px, 0, 7); ctx.fill(); }
    for (const v of V) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(v.x, v.y, 6.5 * px, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  if (!l.locked) {
    for (const [hx, hy] of HANDLES) {
      const p = P(hx * hw, hy * hh), r = 5 * px;
      ctx.fillStyle = "#fff"; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    if (l.type === "vbubble" && l.tail) {
      const t = P(l.tail.x, l.tail.y);
      ctx.fillStyle = "#ff4f7b"; ctx.beginPath(); ctx.arc(t.x, t.y, 7 * px, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.strokeStyle = "#4c8dff";
    }
    if (l.type !== "panel") {
      const t = P(0, -hh), rp = P(0, -hh - 34 * px);
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
      ctx.fillStyle = "#4c8dff"; ctx.beginPath(); ctx.arc(rp.x, rp.y, 6 * px, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

export function set_DC(v) { DC = v; }
