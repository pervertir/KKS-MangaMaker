import { enterAdjust, exitAdjust } from "./adjust.js";
import { $, clamp, deep, uid } from "./core.js";
import { createAt } from "./creation.js";
import { showLib } from "./dock-tabs.js";
import { imageRect } from "./drawing.js";
import { commit } from "./history.js";
import { hitHandle, hitLayer, local } from "./hit.js";
import { hideInline, placeInline, showInline } from "./inline-edit.js";
import { layerMenu } from "./layers.js";
import { popMenu } from "./menus.js";
import { refreshPanels, status } from "./misc.js";
import { refreshProps } from "./props.js";
import { snapBox } from "./snapping.js";
import { H, S, W, layers, selL } from "./state.js";
import { keyLabel } from "./tools.js";
import { DC, corners, cv, interacting, requestDraw, requestView, stage, toPage, zoomAt, set_DC } from "./view.js";

/* ================================================================ pointer */
export const DRAG_TOOLS = { panel: 1, caption: 1, text: 1, sfx: 1, bubble: 1, vbubble: 1, tone: 1, speed: 1 };
export let spaceDown = false;
/* tones and lines clipped to a panel move and stretch with it */
export function clipKids(l) {
  if (l.type !== "panel") return [];
  return layers().filter(q => q.clip === l.id).map(q => ({ q, x: q.x, y: q.y, w: q.w, h: q.h }));
}
export function followPanel(d, l) {
  if (!d.kids?.length || d.dup) return;
  const L = d.l0, sx = l.w / L.w, sy = l.h / L.h;
  for (const k of d.kids) { k.q.x = l.x + (k.x - L.x) * sx; k.q.y = l.y + (k.y - L.y) * sy; k.q.w = k.w * sx; k.q.h = k.h * sy; }
}
export function snapEdges(c) {
  const box = { ...c }, g = snapBox(box, null, 7 / S.view.s);
  return g;
}
export function resizeLayer(l, d, p, shift) {
  const L = d.l0, { a } = corners(L), c = Math.cos(-a), s = Math.sin(-a);
  const cx0 = L.x + L.w / 2, cy0 = L.y + L.h / 2;
  const qx = (p.x - cx0) * c - (p.y - cy0) * s, qy = (p.x - cx0) * s + (p.y - cy0) * c;
  let w = d.hx ? Math.max(12, d.hx * qx + L.w / 2) : L.w;
  let hh = d.hy ? Math.max(12, d.hy * qy + L.h / 2) : L.h;
  const keep = (l.type === "bubble" || l.type === "image") !== shift;
  if (keep && d.hx && d.hy) { const k = Math.max(w / L.w, hh / L.h); w = L.w * k; hh = L.h * k; }
  else if (keep && (l.type === "bubble" || l.type === "image")) {
    if (d.hx) hh = L.h * w / L.w; else w = L.w * hh / L.h;
  }
  const lx = d.hx ? d.hx * (w - L.w) / 2 : 0, ly = d.hy ? d.hy * (hh - L.h) / 2 : 0;
  const ca = Math.cos(a), sa = Math.sin(a);
  const ncx = cx0 + lx * ca - ly * sa, ncy = cy0 + lx * sa + ly * ca;
  l.w = w; l.h = hh; l.x = ncx - w / 2; l.y = ncy - hh / 2;
  if (L.tail) l.tail = { x: L.tail.x * w / L.w, y: L.tail.y * hh / L.h };
  if (l.type === "panel" && S.showGuides && !l.rotate) {
    const box = { x: l.x, y: l.y, w: l.w, h: l.h };
    S.guides = [];
    // snap only the moving edges
    const thr = 7 / S.view.s, snapV = (v, ts) => { for (const t of ts) if (Math.abs(t - v) < thr) return t; return null; };
    const xs = [0, W(), ...layers().filter(o => o.id !== l.id && o.type === "panel").flatMap(o => [o.x, o.x + o.w, o.x - 30 - o.border, o.x + o.w + 30 + o.border])];
    const ys = [0, H(), ...layers().filter(o => o.id !== l.id && o.type === "panel").flatMap(o => [o.y, o.y + o.h, o.y - 30 - o.border, o.y + o.h + 30 + o.border])];
    if (d.hx === 1) { const t = snapV(box.x + box.w, xs); if (t != null) { l.w = t - l.x; S.guides.push({ x: t }); } }
    if (d.hx === -1) { const t = snapV(box.x, xs); if (t != null) { l.w += l.x - t; l.x = t; S.guides.push({ x: t }); } }
    if (d.hy === 1) { const t = snapV(box.y + box.h, ys); if (t != null) { l.h = t - l.y; S.guides.push({ y: t }); } }
    if (d.hy === -1) { const t = snapV(box.y, ys); if (t != null) { l.h += l.y - t; l.y = t; S.guides.push({ y: t }); } }
  }
}
export function hoverCursor(p) {
  let c = "default";
  if (spaceDown || S.tool === "hand") c = "grab";
  else if (S.adjust) c = "move";
  else if (S.tool !== "move") c = "crosshair";
  else {
    const hh = hitHandle(selL(), p);
    if (hh) c = hh.rot ? "alias" : (hh.hx && hh.hy ? (hh.hx === hh.hy ? "nwse-resize" : "nesw-resize") : hh.hx ? "ew-resize" : "ns-resize");
    else if (hitLayer(p)) c = "move";
  }
  cv.style.cursor = c;
}

export function set_spaceDown(v) { spaceDown = v; }

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_pointer() {
  cv.addEventListener("contextmenu", e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), hit = hitLayer(toPage(e.clientX - r.left, e.clientY - r.top));
    if (hit) { S.sel = hit.id; refreshPanels(); requestDraw(); }
    popMenu(e.clientX, e.clientY, layerMenu());
  });

  cv.addEventListener("pointerdown", e => {
    if (!S.doc) return;
    if (e.button === 2) return;
    hideInline(true);
    try { cv.setPointerCapture(e.pointerId); } catch { }
    const r = cv.getBoundingClientRect(), sp = { x: e.clientX - r.left, y: e.clientY - r.top }, p = toPage(sp.x, sp.y);
    if (e.button === 1 || spaceDown || S.tool === "hand") {
      S.drag = { pan: true, sx: sp.x, sy: sp.y, tx: S.view.tx, ty: S.view.ty }; stage.classList.add("grabbing"); return;
    }
    if (S.adjust) {
      const pl = layers().find(l => l.id === S.adjust);
      if (pl && pl.image && hitLayer(p, l => l.id === pl.id)) {
        S.drag = { adjust: pl, layer: pl, p0: p, f0: [...(pl.image.focus || [0.5, 0.5])] }; return;
      }
      exitAdjust();
    }
    if (S.tool === "move") {
      const cur = selL(), hh = hitHandle(cur, p);
      if (hh) {
        S.drag = { layer: cur, l0: deep(cur), p0: p, kids: clipKids(cur), ...(hh.tail ? { tail: true } : hh.rot ? { rot: true } : { hx: hh.hx, hy: hh.hy }) }; return;
      }
      const hit = (e.altKey || e.metaKey) ? hitLayer(p, l => l.type === "panel") : hitLayer(p);
      S.sel = hit ? hit.id : null;
      refreshPanels();
      if (hit && !hit.locked) S.drag = { layer: hit, l0: deep(hit), p0: p, move: true, dup: e.altKey && !e.metaKey, kids: clipKids(hit) };
      else if (hit && hit.type === "panel") status(`Panel locked: ${keyLabel("mod+l")} unlocks it to move or resize (renders, Pose… and splitting still work)`);
      requestView(); return;
    }
    if (DRAG_TOOLS[S.tool]) { S.drag = { creating: { x: p.x, y: p.y, w: 0, h: 0 }, p0: p, tool: S.tool }; requestDraw(); }
  });

  cv.addEventListener("pointermove", e => {
    const r = cv.getBoundingClientRect(), sp = { x: e.clientX - r.left, y: e.clientY - r.top }, p = toPage(sp.x, sp.y);
    $("#st-pos").textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
    const d = S.drag;
    if (!d) { hoverCursor(p); return; }
    if (d.pan) { S.view.tx = d.tx + sp.x - d.sx; S.view.ty = d.ty + sp.y - d.sy; interacting(); requestView(); return; }
    if (d.adjust) {
      const l = d.adjust;
      const rr = imageRect(l), dx = p.x - d.p0.x, dy = p.y - d.p0.y, fl = l.image.flip ? -1 : 1;
      const hx = l.w / 2 / rr.w, hy = l.h / 2 / rr.h;
      l.image.focus = [clamp(d.f0[0] - fl * dx / rr.w, hx, 1 - hx), clamp(d.f0[1] - dy / rr.h, hy, 1 - hy)].map(v => +v.toFixed(4));
      if (l.image.fit === "contain") l.image.focus = d.f0;
      requestDraw(); return;
    }
    if (d.creating) {
      const c = d.creating;
      c.x = Math.min(d.p0.x, p.x); c.y = Math.min(d.p0.y, p.y); c.w = Math.abs(p.x - d.p0.x); c.h = Math.abs(p.y - d.p0.y);
      S.guides = d.tool === "panel" && S.showGuides ? snapEdges(c) : [];
      requestDraw(); return;
    }
    const l = d.layer;
    if (d.dup && !d.duped) { d.duped = true; const c = deep(d.l0); c.id = uid(); layers().splice(layers().indexOf(l), 0, c); }
    if (d.move) {
      const box = { x: d.l0.x + p.x - d.p0.x, y: d.l0.y + p.y - d.p0.y, w: l.w, h: l.h };
      if (e.shiftKey) { if (Math.abs(p.x - d.p0.x) > Math.abs(p.y - d.p0.y)) box.y = d.l0.y; else box.x = d.l0.x; }
      S.guides = S.showGuides && !e.ctrlKey ? snapBox(box, l.id, 7 / S.view.s) : [];
      l.x = box.x; l.y = box.y;
      followPanel(d, l);
    } else if (d.tail) {
      const q = local(l, p); l.tail = { x: +q.x.toFixed(1), y: +q.y.toFixed(1) };
    } else if (d.rot) {
      const { cx, cy } = corners(d.l0);
      let a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      a = ((a + 180) % 360 + 360) % 360 - 180;
      l.rotate = +a.toFixed(1);
    } else {
      resizeLayer(l, d, p, e.shiftKey);
      followPanel(d, l);
    }
    requestDraw(); refreshProps(true);
  });

  cv.addEventListener("pointerup", e => {
    const d = S.drag; S.drag = null; S.guides = []; set_DC(null); stage.classList.remove("grabbing");
    if (d && !d.pan) requestDraw();
    if (!d) return;
    if (d.pan) return;
    if (d.adjust) { commit("Image moved"); return; }
    if (d.creating) {
      const c = d.creating, small = c.w < 12 && c.h < 12;
      createAt(d.tool, c, small);
      return;
    }
    const l = d.layer;
    if (JSON.stringify(l) !== JSON.stringify(d.l0) || d.duped) commit(d.duped ? "Duplicated" : d.move ? "Moved" : d.tail ? "Tail moved" : d.rot ? "Rotated" : "Resized");
    requestDraw();
  });

  cv.addEventListener("dblclick", e => {
    const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
    const l = hitLayer(p);
    if (!l) return;
    S.sel = l.id;
    if (l.type === "panel") { if (l.image) enterAdjust(l); else { showLib("shots"); status("Drag a render from Shots onto the panel"); } }
    else if (["bubble", "caption", "text", "vbubble"].includes(l.type)) showInline(l);
    refreshPanels();
  });

  cv.addEventListener("wheel", e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (S.adjust && !e.ctrlKey && !e.metaKey) {
      const l = layers().find(q => q.id === S.adjust);
      if (l?.image) {
        l.image.zoom = +clamp((l.image.zoom || 1) * Math.exp(-e.deltaY * 0.0015), l.image.fit === "contain" ? 0.2 : 1, 8).toFixed(3);
        requestDraw(); refreshProps(true); clearTimeout(S.wheelT); S.wheelT = setTimeout(() => commit("Image zoom"), 400); return;
      }
    }
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
    else { S.view.tx -= e.deltaX; S.view.ty -= e.deltaY; interacting(); requestView(); placeInline(); }
  }, { passive: false });
}
