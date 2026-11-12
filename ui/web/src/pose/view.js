import { $ } from "../editor/core.js";
import { HANDLES } from "../editor/view.js";
import { drawSkeleton } from "./draw.js";
import { bounds, project } from "./geometry.js";
import { JOINT_NAMES, P } from "./model.js";
import { pcur } from "./scene.js";
import { bg, groundFigures, preview } from "./scene3d.ts";
import { floorDepth, vanishing } from "./camera3d.ts";

/* ---------------------------------------------------------------- view */
export const pcv = () => $("#pscanvas");
export function pfit() {
  const st = $("#psstage"), r = st.getBoundingClientRect(), cv = pcv(), dpr = devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const s = Math.min((r.width - 40) / P.scene.w, (r.height - 40) / P.scene.h);
  P.view = { s, ox: (r.width - P.scene.w * s) / 2, oy: (r.height - P.scene.h * s) / 2 };
  pdraw();
}
export const pToScene = (sx, sy) => ({ x: (sx - P.view.ox) / P.view.s, y: (sy - P.view.oy) / P.view.s });
export let pQueued = false;
export function pdraw() { if (!pQueued) { pQueued = true; requestAnimationFrame(pdrawNow); } }
export function pdrawNow() {
  pQueued = false;
  const cv = pcv(); if (!cv || $("#posestudio").hidden) return;
  const g = cv.getContext("2d"), dpr = devicePixelRatio || 1, { s, ox, oy } = P.view, { w, h } = P.scene;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  g.save(); g.translate(ox, oy); g.scale(s, s);
  g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  const b3 = bg();
  if (b3) {
    groundFigures();
    const room = preview(pdraw);
    if (room) { g.globalAlpha = b3.alpha ?? 0.55; g.drawImage(room, 0, 0, w, h); g.globalAlpha = 1; }
    const hz = vanishing(b3.cam, w, h).horizon;
    if (hz != null) { g.strokeStyle = "#f5b84baa"; g.lineWidth = 1.5 / s; g.setLineDash([8 / s, 6 / s]); g.beginPath(); g.moveTo(0, hz * h); g.lineTo(w, hz * h); g.stroke(); g.setLineDash([]); }
    if (b3.ground) for (const c of P.scene.chars) {      // where each figure stands
      if (c.hidden || floorDepth(b3.cam, w, h, c.x * w, c.y * h) == null) continue;
      const rr = Math.max(6, 0.18 * c.scale * h / 1.75);
      g.fillStyle = c.id === P.sel ? "#4c8dff55" : "#ffffff33"; g.beginPath(); g.ellipse(c.x * w, c.y * h, rr, rr * 0.28, 0, 0, Math.PI * 2); g.fill();
    }
  }
  if (P.ref) { g.globalAlpha = P.refAlpha; g.drawImage(P.ref, 0, 0, w, h); g.globalAlpha = 1; }
  g.strokeStyle = "#ffffff18"; g.lineWidth = 1 / s;                         // thirds guide
  for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(w * f, 0); g.lineTo(w * f, h); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke(); }
  const unit = Math.min(w, h) / 1024;
  for (const c of P.scene.chars) {
    const pr = project(c, w, h); if (!pr) continue;
    drawSkeleton(g, pr, unit, { alpha: c.hidden ? 0.15 : 1, hands: P.showHands });
    if (c.id === P.sel) {
      const b = bounds(pr);
      // same look as a selected layer on the page: box, 8 square handles, rotation knob on a stem
      g.strokeStyle = "#4c8dff"; g.lineWidth = 1.5 / s; g.strokeRect(b.x, b.y, b.w, b.h);
      const rr = 5 / s;
      for (const [hx, hy] of HANDLES) {
        const x = b.x + (hx + 1) / 2 * b.w, y = b.y + (hy + 1) / 2 * b.h;
        g.fillStyle = "#fff"; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); g.strokeRect(x - rr, y - rr, rr * 2, rr * 2);
      }
      g.beginPath(); g.moveTo(b.x + b.w / 2, b.y); g.lineTo(b.x + b.w / 2, b.y - 34 / s); g.stroke();
      g.fillStyle = "#4c8dff"; g.beginPath(); g.arc(b.x + b.w / 2, b.y - 34 / s, 6 / s, 0, Math.PI * 2); g.fill();
      // joints get a ring so they read as draggable
      g.strokeStyle = "#fff"; g.lineWidth = 1.2 / s;
      pr.body.forEach((p, i) => { if (pr.miss.has(i)) return; g.beginPath(); g.arc(p[0], p[1], 7 / s, 0, Math.PI * 2); g.stroke(); });
      g.font = `${12 / s}px sans-serif`; g.fillStyle = "#cfe0ff";
      g.fillText(c.name || c.label, b.x, b.y - 4 / s);
    }
  }
  if (P.joint && P.hoverJoint != null) {
    const c = pcur(), pr = c && project(c, w, h), p = pr && jointPos(pr, P.hoverJoint);
    if (p) { g.fillStyle = "#fff"; g.font = `${12 / s}px sans-serif`; g.fillText(jointLabel(P.hoverJoint), p[0] + 10 / s, p[1] - 10 / s); }
  }
  g.restore();
  $("#psinfo").textContent = `${w}×${h} · ${P.scene.chars.length} character${P.scene.chars.length === 1 ? "" : "s"}${P.shot ? " · shot " + P.shot : ""}`;
}
export function jointPos(pr, key) {
  if (typeof key === "number") return pr.body[key];
  const s = key[1] === "L" ? 0 : 1; return pr.hands[s][+key.slice(2)];
}
export const jointLabel = key => typeof key === "number" ? JOINT_NAMES[key] : `${key[1] === "L" ? "left" : "right"} hand point ${key.slice(2)}`;
