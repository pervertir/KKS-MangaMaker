import { clamp, deep } from "../editor/core.js";
import { HANDLES } from "../editor/view.js";
import { bounds, project } from "./geometry.js";
import { ikDrag } from "./ik.js";
import { FIG_H, P } from "./model.js";
import { pcommit, pcur } from "./scene.js";
import { renderPoseSide } from "./side.js";
import { pToScene, pcv, pdraw } from "./view.js";
import { bg } from "./scene3d.ts";

/* ---------------------------------------------------------------- pointer */
export function phit(pt) {
  const { w, h } = P.scene, r = 9 / P.view.s;
  const c = pcur();
  if (c) {                                                  // joints and handles of the selected figure first
    const pr = project(c, w, h);
    if (pr) {
      const b = bounds(pr);
      if (Math.hypot(pt.x - (b.x + b.w / 2), pt.y - (b.y - 34 / P.view.s)) < r * 1.2) return { kind: "rotate", c, pr, b };
      for (const [hx, hy] of HANDLES) {
        const x = b.x + (hx + 1) / 2 * b.w, y = b.y + (hy + 1) / 2 * b.h;
        if (Math.abs(pt.x - x) < r && Math.abs(pt.y - y) < r)       // scale about the opposite handle
          return { kind: "scale", c, pr, b, anchor: [b.x + (1 - hx) / 2 * b.w, b.y + (1 - hy) / 2 * b.h], hx, hy };
      }
      let best = null, bd = r;
      pr.body.forEach((p, i) => { if (pr.miss.has(i)) return; const d = Math.hypot(p[0] - pt.x, p[1] - pt.y); if (d < bd) { bd = d; best = i; } });
      if (P.showHands) pr.hands.forEach((hd, s) => hd.forEach((p, i) => { if (i === 0 || pr.hoff[s][i]) return; const d = Math.hypot(p[0] - pt.x, p[1] - pt.y); if (d < bd * 0.8) { bd = d; best = `h${s ? "R" : "L"}${i}`; } }));
      if (best != null) return { kind: "joint", c, pr, key: best };
    }
  }
  for (let i = P.scene.chars.length - 1; i >= 0; i--) {
    const ch = P.scene.chars[i], pr = project(ch, w, h); if (!pr) continue;
    const b = bounds(pr);
    if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return { kind: "move", c: ch, pr, b };
  }
  return null;
}
export function psDown(e) {
  if (e.button !== 0) return;
  const r = pcv().getBoundingClientRect(), pt = pToScene(e.clientX - r.left, e.clientY - r.top);
  const hit = phit(pt);
  if (!hit) {
    P.sel = null; renderPoseSide(); pdraw();
    const b = bg();     // empty space over a 3D background: drag looks around, Shift-drag walks, Alt-drag rises
    if (b) { P.drag = { kind: "cam", start: { x: e.clientX, y: e.clientY }, orig: deep(b.cam), moved: false }; pcv().setPointerCapture(e.pointerId); }
    return;
  }
  if (P.sel !== hit.c.id) { P.sel = hit.c.id; renderPoseSide(); }
  const c = hit.c;
  P.drag = { ...hit, start: pt, orig: deep(c), moved: false };
  pcv().setPointerCapture(e.pointerId);
  pdraw();
}
export function psMove(e) {
  const r = pcv().getBoundingClientRect(), pt = pToScene(e.clientX - r.left, e.clientY - r.top);
  const d = P.drag;
  if (d?.kind === "cam") {
    const b = bg(); if (!b) return;
    const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y, o = d.orig, cam = b.cam;
    if (e.shiftKey) {
      const y = o.yaw * Math.PI / 180, k = 0.01;
      cam.x = +(o.x - (Math.cos(y) * dx + Math.sin(y) * dy) * k).toFixed(3);
      cam.z = +(o.z - (-Math.sin(y) * dx + Math.cos(y) * dy) * k).toFixed(3);
    } else if (e.altKey) cam.y = +clamp(o.y - dy * 0.01, 0.05, 60).toFixed(3);
    else { cam.yaw = +(((o.yaw + dx * 0.15) + 540) % 360 - 180).toFixed(2); cam.pitch = +clamp(o.pitch + dy * 0.15, -85, 85).toFixed(2); }
    d.moved = true; pdraw(); renderPoseSide(true); return;
  }
  if (!d) {
    const hit = phit(pt);
    pcv().style.cursor = !hit ? "default" : hit.kind === "joint" ? "crosshair" : hit.kind === "rotate" ? "grab" : hit.kind === "move" ? "move"
      : (hit.hx === 0 ? "ns-resize" : hit.hy === 0 ? "ew-resize" : hit.hx === hit.hy ? "nwse-resize" : "nesw-resize");
    const hj = hit?.kind === "joint" ? hit.key : null;
    if (hj !== P.hoverJoint) { P.hoverJoint = hj; P.joint = hj != null; pdraw(); }
    return;
  }
  const c = d.c, { w, h } = P.scene, dx = pt.x - d.start.x, dy = pt.y - d.start.y;
  d.moved = true;
  if (d.kind === "move") { c.x = d.orig.x + dx / w; c.y = d.orig.y + dy / h; }
  else if (d.kind === "scale") {
    // uniform (a figure can't stretch), about the opposite handle, like a layer with Shift held
    const [axp, ayp] = d.anchor;
    const along = (q) => d.hx === 0 ? Math.abs(q.y - ayp) : d.hy === 0 ? Math.abs(q.x - axp) : Math.hypot(q.x - axp, q.y - ayp);
    let f = along(pt) / Math.max(1, along(d.start));
    f = clamp(d.orig.scale * f, 0.05, 4) / d.orig.scale;
    c.scale = d.orig.scale * f;
    c.x = (axp + (d.orig.x * w - axp) * f) / w; c.y = (ayp + (d.orig.y * h - ayp) * f) / h;
  } else if (d.kind === "rotate") {
    const b = d.b, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const a0 = Math.atan2(d.start.y - cy, d.start.x - cx), a1 = Math.atan2(pt.y - cy, pt.x - cx);
    let deg = d.orig.roll + (a1 - a0) * 180 / Math.PI; if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    c.roll = ((deg + 540) % 360) - 180;
  } else if (d.kind === "joint") {
    if (P.ik && !e.altKey && ikDrag(d, c, pt)) { /* the limb followed */ }
    else { const k = d.pr.k, e0 = d.orig.edits[d.key] || [0, 0]; c.edits[d.key] = [e0[0] + dx / k, e0[1] + dy / k]; }
  }
  pdraw();
}
export function psUp() {
  const d = P.drag; P.drag = null; if (!d) return;
  if (d.moved) pcommit({ cam: "Camera moved", move: "Moved", scale: "Scaled", rotate: "Rotated", joint: "Joint moved" }[d.kind]);
}
export function psWheel(e) {
  const c = pcur(), b = bg();
  if (!c && b) {          // no figure selected: the wheel walks the camera forward and back
    e.preventDefault();
    const y = b.cam.yaw * Math.PI / 180, step = (e.deltaY > 0 ? 1 : -1) * 0.25;
    b.cam.x = +(b.cam.x + Math.sin(y) * step).toFixed(3); b.cam.z = +(b.cam.z + Math.cos(y) * step).toFixed(3);
    clearTimeout(P.wheelT); P.wheelT = setTimeout(() => pcommit("Camera moved"), 250);
    pdraw(); renderPoseSide(true); return;
  }
  if (!c) return;
  e.preventDefault();
  if (e.shiftKey) c.yaw = ((c.yaw + (e.deltaY > 0 ? 10 : -10) + 540) % 360) - 180;
  else c.scale = clamp(c.scale * (e.deltaY > 0 ? 0.95 : 1.05), 0.05, 4);
  clearTimeout(P.wheelT); P.wheelT = setTimeout(() => pcommit(e.shiftKey ? "Turned" : "Scaled"), 250);
  pdraw(); renderPoseSide(true);
}

/* Turn every figure together about the scene's vertical axis, keeping where they stand relative to each
   other in depth (c.z, metres) as well as across: how a group pose is viewed from the side or behind. */
export function turnAll(deg) {
  const { w: W, h: H } = P.scene, a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const cs = P.scene.chars.filter(c => !c.hidden); if (!cs.length) return;
  const ks = cs.map(c => c.scale * H / FIG_H), k = ks.reduce((x, y) => x + y, 0) / ks.length;
  const X = cs.map(c => (c.x * W - W / 2) / k), cx = X.reduce((x, y) => x + y, 0) / X.length;
  const cz = cs.reduce((x, c) => x + (c.z || 0), 0) / cs.length;
  cs.forEach((c, i) => {
    const x = X[i] - cx, z = (c.z || 0) - cz;
    c.x = (W / 2 + (cx + x * ca + z * sa) * k) / W; c.z = cz - x * sa + z * ca;
    c.yaw = ((c.yaw + deg + 540) % 360) - 180;
  });
  // keep figures that move to the front drawn on top
  P.scene.chars.sort((p, q) => (p.z || 0) - (q.z || 0));
}
