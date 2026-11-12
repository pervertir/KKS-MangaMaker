import { project } from "./geometry.js";
import { HAND_EDGES, KCOL, LIMBS, P } from "./model.js";

/* ---------------------------------------------------------------- OpenPose drawing */
export function drawSkeleton(g, pr, unit, opt = {}) {
  const stick = Math.max(1.5, unit * 4), rad = Math.max(1.5, unit * 4);
  g.save();
  g.globalAlpha = opt.alpha ?? 1;
  for (let i = 0; i < LIMBS.length; i++) {               // limbs: soft ellipses, like the preprocessors
    const [a, b] = LIMBS[i], A = pr.body[a], B = pr.body[b];
    if (!A || !B || pr.hide?.has(a) || pr.hide?.has(b)) continue;
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, len = Math.hypot(B[0] - A[0], B[1] - A[1]) / 2, ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
    g.globalAlpha = (opt.alpha ?? 1) * 0.6; g.fillStyle = KCOL[i];
    g.beginPath(); g.ellipse(mx, my, Math.max(len, 0.1), stick, ang, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = opt.alpha ?? 1;
  pr.body.forEach((p, i) => { if (pr.hide?.has(i)) return; g.fillStyle = KCOL[i]; g.beginPath(); g.arc(p[0], p[1], rad, 0, Math.PI * 2); g.fill(); });
  if (opt.hands !== false) pr.hands.forEach((hd, s) => {
    const off = pr.hoff?.[s] || [];
    if (!hd.length || (off.length && off.every(Boolean))) return;
    g.lineWidth = Math.max(1, unit * 2);
    HAND_EDGES.forEach(([a, b], i) => {
      if (off[a] || off[b]) return;
      g.strokeStyle = `hsl(${(i / HAND_EDGES.length) * 360},100%,50%)`;
      g.beginPath(); g.moveTo(hd[a][0], hd[a][1]); g.lineTo(hd[b][0], hd[b][1]); g.stroke();
    });
    g.fillStyle = "#0000ff";
    hd.forEach((p, i) => { if (off[i]) return; g.beginPath(); g.arc(p[0], p[1], Math.max(1, unit * 2), 0, Math.PI * 2); g.fill(); });
  });
  g.restore();
}
/* the pose image ControlNet gets: black, every visible figure, nothing else */
export function renderPosePNG() {
  const { w, h } = P.scene, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  const unit = Math.min(w, h) / 1024;
  for (const ch of P.scene.chars) { if (ch.hidden) continue; const pr = project(ch, w, h); if (pr) drawSkeleton(g, pr, unit, { hands: P.showHands }); }
  return c;
}
