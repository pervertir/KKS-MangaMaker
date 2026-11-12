import { addLayer, insertIndexForPanel } from "./creation.js";
import { commit } from "./history.js";
import { status } from "./misc.js";
import { refreshProps } from "./props.js";
import { H, S, W, layers } from "./state.ts";
import { requestDraw, requestView } from "./view.js";
import { dedupe, panelBase, polyArea, setPanelPoly } from "./frames.js";

/* ================================================================ polygon panels */
/* a polygon panel's corners are handles of their own, so its box handles stand a little outside them */
export const isPolyPanel = l => l?.type === "panel" && l.shape === "poly" && l.pts?.length >= 3 && l.pts.length <= 24;   // a curved piece (a split circle) has too many to handle
export const boxPad = (l, px) => isPolyPanel(l) ? 18 * px : 0;
export function vertexHandles(l) {
  const P = panelBase(l);
  return { P, M: P.map((p, i) => { const q = P[(i + 1) % P.length]; return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; }) };
}
export function hitVertex(l, p, px) {
  if (!isPolyPanel(l) || l.locked) return null;
  const { P: V, M } = vertexHandles(l);
  for (let i = 0; i < V.length; i++) if (Math.hypot(p.x - V[i].x, p.y - V[i].y) < 10 * px) return { kind: "vert", i };
  for (let i = 0; i < M.length; i++) if (Math.hypot(p.x - M[i].x, p.y - M[i].y) < 8 * px) return { kind: "mid", i };
  return null;
}
export function drawVertices(ctx, l, px) {
  if (l.locked || !isPolyPanel(l)) return;
  const { P: V, M } = vertexHandles(l);
  ctx.save(); ctx.strokeStyle = "#4c8dff"; ctx.lineWidth = 1.5 * px;
  for (const m of M) { ctx.fillStyle = "#4c8dff88"; ctx.beginPath(); ctx.arc(m.x, m.y, 4 * px, 0, 7); ctx.fill(); }
  for (const v of V) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(v.x, v.y, 6.5 * px, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}
/* the Polygon panel tool: click corners, close on the first corner, a double-click or Enter */
export function snapPoint(p, e) {
  if (!S.showGuides || e?.ctrlKey) return { ...p };
  const thr = 8 / S.view.s, xs = [0, W(), 60, W() - 60], ys = [0, H(), 60, H() - 60];
  for (const q of layers()) if (q.type === "panel" && q.visible) for (const v of panelBase(q)) { xs.push(v.x); ys.push(v.y); }
  for (const v of S.polyDraft || []) { xs.push(v.x); ys.push(v.y); }
  const near = (v, ts) => ts.reduce((b, t) => Math.abs(t - v) < thr && (b == null || Math.abs(t - v) < Math.abs(b - v)) ? t : b, null);
  return { x: near(p.x, xs) ?? p.x, y: near(p.y, ys) ?? p.y };
}
export function polyClick(p) {
  const D = (S.polyDraft ||= []), q = S.polyHover || p;
  if (D.length >= 3 && Math.hypot(q.x - D[0].x, q.y - D[0].y) < 12 / S.view.s) return finishPoly();
  const last = D[D.length - 1];
  if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 2 / S.view.s) D.push({ x: q.x, y: q.y });
  status(`${D.length} corner${D.length > 1 ? "s" : ""}: click the first corner or press Enter to close`); requestView();
}
export function finishPoly() {
  const D = dedupe(S.polyDraft || []); S.polyDraft = null; S.polyHover = null;
  if (D.length < 3 || Math.abs(polyArea(D)) < 400) { requestView(); return status("A panel needs at least three corners"); }
  addLayer(setPanelPoly({ type: "panel", shot: "", image: null }, D, true), insertIndexForPanel());
  commit("Added polygon panel"); requestDraw();
}
/* drag one corner of a polygon panel; it snaps to page edges and to other panels' corners and edges */
export function moveVertex(l, d, p, e) {
  const V = d.v0.map(v => ({ ...v })), o = d.v0[d.vert];
  let x = p.x, y = p.y;
  if (e.shiftKey) { if (Math.abs(x - o.x) > Math.abs(y - o.y)) y = o.y; else x = o.x; }
  S.guides = [];
  if (S.showGuides && !e.ctrlKey) {
    const thr = 7 / S.view.s, xs = [0, W()], ys = [0, H()];
    for (const q of layers()) if (q.type === "panel" && q.id !== l.id && q.visible) {
      xs.push(q.x, q.x + q.w); ys.push(q.y, q.y + q.h);
      for (const v of panelBase(q)) { xs.push(v.x); ys.push(v.y); }
    }
    V.forEach((v, i) => { if (i !== d.vert) { xs.push(v.x); ys.push(v.y); } });
    const near = (v, ts) => ts.reduce((b, t) => Math.abs(t - v) < thr && (b == null || Math.abs(t - v) < Math.abs(b - v)) ? t : b, null);
    const sx = near(x, xs), sy = near(y, ys);
    if (sx != null) { x = sx; S.guides.push({ x: sx }); }
    if (sy != null) { y = sy; S.guides.push({ y: sy }); }
  }
  V[d.vert] = { x, y };
  setPanelPoly(l, V, true);
}
export function removeVertex(l, i) {
  const V = panelBase(l);
  if (V.length <= 3) return status("A panel needs at least three corners");
  V.splice(i, 1); setPanelPoly(l, V); commit("Corner removed"); requestDraw(); refreshProps(true);
}
