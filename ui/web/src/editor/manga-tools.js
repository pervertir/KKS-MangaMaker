import { clamp } from "./core.js";
import { paperOf } from "./creation.js";
import { drawLayer } from "./drawing.js";
import { H, W } from "./state.ts";
import { drawText } from "./text.js";

/* ================================================================ manga tools */
export function rng(seed) { // mulberry32: same seed, same lines
  let a = (seed * 2654435761) >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/* drawn bubbles: body + tail in the bubble's own (unrotated, centred) frame */
export const VSHAPES = [["oval", "Oval (speech)"], ["box", "Rounded box"], ["cloud", "Cloud (thought)"], ["burst", "Burst (shout)"], ["whisper", "Dashed (whisper)"], ["flash", "Flash (inner voice)"]];
export function vBody(l) {
  const p = new Path2D(), rx = l.w / 2, ry = l.h / 2;
  if (l.shape === "box") { p.roundRect(-rx, -ry, l.w, l.h, Math.min(l.w, l.h) * 0.14); return p; }
  if (l.shape === "cloud") {
    const n = clamp(Math.round((l.w + l.h) / (Math.min(l.w, l.h) * 0.3)), 9, 24), r = rng(l.seed), pts = [];
    for (let k = 0; k < n; k++) { const a = (k + (r() - 0.5) * 0.3) / n * Math.PI * 2; pts.push([Math.cos(a) * rx * 0.86, Math.sin(a) * ry * 0.86, a]); }
    p.moveTo(pts[0][0], pts[0][1]);
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n], am = (a[2] + (k === n - 1 ? b[2] + Math.PI * 2 : b[2])) / 2, bulge = 1.2 + r() * 0.08;
      p.quadraticCurveTo(Math.cos(am) * rx * bulge, Math.sin(am) * ry * bulge, b[0], b[1]);
    }
    p.closePath(); return p;
  }
  if (l.shape === "burst" || l.shape === "flash") {
    const n = l.spikes || 16, r = rng(l.seed), flash = l.shape === "flash";
    for (let k = 0; k < n * 2; k++) {
      const a = k / (n * 2) * Math.PI * 2, out = k % 2 === 0;
      const f = flash ? (out ? 1 + r() * 0.12 : 0.9) : (out ? 0.98 + r() * 0.3 : 0.74 + r() * 0.06);
      const x = Math.cos(a) * rx * f, y = Math.sin(a) * ry * f;
      k ? p.lineTo(x, y) : p.moveTo(x, y);
    }
    p.closePath(); return p;
  }
  p.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); return p;
}
export function vTail(l) {
  if (!l.tail) return [];
  const rx = l.w / 2, ry = l.h / 2, tx = l.tail.x, ty = l.tail.y;
  const th = Math.atan2(ty / ry, tx / rx);
  if (l.shape === "cloud") {           // thought bubbles trail little circles
    const bx = Math.cos(th) * rx * 0.9, by = Math.sin(th) * ry * 0.9, out = [];
    for (let i = 1; i <= 3; i++) {
      const t = i / 3.2, rr = Math.min(l.w, l.h) * (0.1 - i * 0.022);
      const c = new Path2D(); c.ellipse(bx + (tx - bx) * t, by + (ty - by) * t, rr * 1.3, rr, 0, 0, Math.PI * 2); out.push(c);
    }
    return out;
  }
  const d = (l.tailW || 0.22) * 1.1, k = l.shape === "box" ? 0.8 : ["burst", "flash"].includes(l.shape) ? 0.62 : 0.86;
  const b1 = [Math.cos(th - d) * rx * k, Math.sin(th - d) * ry * k], b2 = [Math.cos(th + d) * rx * k, Math.sin(th + d) * ry * k];
  const mx = (b1[0] + b2[0]) / 2, my = (b1[1] + b2[1]) / 2, bend = 0.18;
  const nx = -(ty - my) * bend, ny = (tx - mx) * bend;
  const p = new Path2D();
  p.moveTo(b1[0], b1[1]);
  p.quadraticCurveTo((b1[0] + tx) / 2 + nx, (b1[1] + ty) / 2 + ny, tx, ty);
  p.quadraticCurveTo((b2[0] + tx) / 2 + nx * 0.6, (b2[1] + ty) / 2 + ny * 0.6, b2[0], b2[1]);
  p.closePath();
  return [p];
}
export const VTEXT = { oval: [0.72, 0.66], box: [0.86, 0.8], cloud: [0.64, 0.58], burst: [0.56, 0.5], whisper: [0.72, 0.66], flash: [0.66, 0.6] };
export function drawVBubble(ctx, l, maxFont) {
  const body = vBody(l), tails = vTail(l);
  ctx.lineJoin = "round"; ctx.lineWidth = l.strokeW; ctx.strokeStyle = l.stroke; ctx.fillStyle = l.fill;
  if (l.shape === "whisper") ctx.setLineDash([l.strokeW * 3, l.strokeW * 2.2]);
  if (l.strokeW > 0) { for (const t of tails) ctx.stroke(t); ctx.stroke(body); }
  for (const t of tails) ctx.fill(t);
  ctx.fill(body);
  if (l.shape === "cloud" && l.strokeW > 0) for (const t of tails) ctx.stroke(t);
  ctx.setLineDash([]);
  const [fw, fh] = VTEXT[l.shape] || VTEXT.oval;
  const light = (() => { const c = l.fill.replace("#", ""); const v = parseInt(c.length === 3 ? c.split("").map(x => x + x).join("") : c, 16);
    return ((v >> 16 & 255) * 0.3 + (v >> 8 & 255) * 0.59 + (v & 255) * 0.11) > 110; })();
  drawText(ctx, { ...l, strokeWidth: 0 }, 0, 0, l.w * fw, l.h * fh, maxFont, l.color === "auto" ? (light ? "#111111" : "#ffffff") : l.color);
}
export function drawFlipped(ctx, im, r, flip) {
  if (!flip) return ctx.drawImage(im, r.x, r.y, r.w, r.h);
  ctx.save(); ctx.translate(r.x + r.w, r.y); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, r.w, r.h); ctx.restore();
}
export function lum(hex) {             // 0 (black) .. 1 (white)
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "") || /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex || "");
  if (!m) return 1;
  const [r, g, b] = m.slice(1, 4).map(v => parseInt(v.length === 1 ? v + v : v, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function drawPage(ctx, pg, opt = {}) {
  ctx.fillStyle = paperOf(pg, opt);
  ctx.fillRect(0, 0, W(), H());
  for (const l of pg.layers) drawLayer(ctx, l, { ...opt, ghost: opt.ghostId === l.id });
}
